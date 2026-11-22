package mail

import (
	"bytes"
	"cmp"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"net/textproto"
	"slices"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"

	"reader/internal/domain"
)

const (
	defaultTimeout  = 3 * time.Minute
	epubContentType = gomail.ContentType("application/epub+zip")
	defaultSubject  = "留白"
	redactedMarker  = "[redacted]"
	dialStep        = "dial smtp server"
)

var (
	authSentinelErrors = []error{
		gomail.ErrPlainAuthNotSupported,
		gomail.ErrLoginAuthNotSupported,
		gomail.ErrCramMD5AuthNotSupported,
		gomail.ErrXOauth2AuthNotSupported,
		gomail.ErrSCRAMSHA1AuthNotSupported,
		gomail.ErrSCRAMSHA1PLUSAuthNotSupported,
		gomail.ErrSCRAMSHA256AuthNotSupported,
		gomail.ErrSCRAMSHA256PLUSAuthNotSupported,
		gomail.ErrNTLMAuthNotSupported,
		gomail.ErrNoSupportedAuthDiscovered,
	}

	base64Encodings = []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	}
)

type Config struct {
	Timeout     time.Duration
	DialContext gomail.DialContextFunc
	TLSConfig   *tls.Config
}

type Sender struct {
	timeout     time.Duration
	dialContext gomail.DialContextFunc
	tlsConfig   *tls.Config
}

var _ domain.MailSender = (*Sender)(nil)

func NewSender(cfg Config) *Sender {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}

	return &Sender{timeout: timeout, dialContext: cfg.DialContext, tlsConfig: cfg.TLSConfig}
}

func (s *Sender) SendEPUB(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
	message, err := buildMessage(delivery, book)
	if err != nil {
		return sanitizedError(delivery.SMTP, "build message", err)
	}

	client, err := s.newClient(delivery.SMTP)
	if err != nil {
		return sanitizedError(delivery.SMTP, "create smtp client", err)
	}

	if err := client.DialWithContext(ctx); err != nil {
		return sanitizedError(delivery.SMTP, dialStep, err)
	}

	sendErr := client.Send(message)
	_ = client.Close()

	if message.IsDelivered() {
		return nil
	}

	if sendErr != nil {
		return sanitizedError(delivery.SMTP, "send epub mail", sendErr)
	}

	if err := message.SendError(); err != nil {
		return sanitizedError(delivery.SMTP, "send epub mail", err)
	}

	return nil
}

func (s *Sender) newClient(smtp domain.SMTPSettings) (*gomail.Client, error) {
	options, err := s.clientOptions(smtp)
	if err != nil {
		return nil, err
	}

	return gomail.NewClient(smtp.Host, options...)
}

func (s *Sender) clientOptions(smtp domain.SMTPSettings) ([]gomail.Option, error) {
	options := []gomail.Option{
		gomail.WithPort(smtp.Port),
		gomail.WithTimeout(s.timeout),
	}

	switch smtp.Security {
	case domain.SMTPSecurityTLS:
		options = append(options, gomail.WithSSL())
	case domain.SMTPSecuritySTARTTLS:
		options = append(options, gomail.WithTLSPolicy(gomail.TLSMandatory))
	default:
		return nil, fmt.Errorf("unsupported smtp security %q", smtp.Security)
	}

	if username := smtpUsername(smtp); username != "" {
		options = append(options,
			gomail.WithUsername(username),
			gomail.WithPassword(smtpPassword(smtp)),
			gomail.WithSMTPAuth(gomail.SMTPAuthAutoDiscover),
		)
	}

	if s.dialContext != nil {
		options = append(options, gomail.WithDialContextFunc(s.dialContext))
	}

	if s.tlsConfig != nil {
		options = append(options, gomail.WithTLSConfig(s.tlsConfig))
	}

	return options, nil
}

func buildMessage(delivery domain.KindleDelivery, book domain.EPUBBook) (*gomail.Msg, error) {
	subject := book.Title
	if subject == "" {
		subject = defaultSubject
	}

	message := gomail.NewMsg()
	if err := message.From(delivery.SMTP.SenderEmail); err != nil {
		return nil, err
	}

	if err := message.To(delivery.KindleEmail); err != nil {
		return nil, err
	}

	message.Subject(subject)
	message.SetBodyString(gomail.TypeTextPlain, subject)

	err := message.AttachReader(
		book.Filename,
		bytes.NewReader(book.Data),
		gomail.WithFileContentType(epubContentType),
	)
	if err != nil {
		return nil, err
	}

	return message, nil
}

func sanitizedError(smtp domain.SMTPSettings, step string, err error) error {
	if summary, ok := authFailureSummary(step, err); ok {
		return fmt.Errorf("send kindle epub: %s: %s", step, summary)
	}

	text := redactSMTPAuthSecrets(domain.SanitizeErrorText(err.Error()), smtp)

	return fmt.Errorf("send kindle epub: %s: %s", step, text)
}

// authFailureSummary classifies go-mail authentication failures and SMTP auth
// status codes into a fixed summary without echoing untrusted server text.
func authFailureSummary(step string, err error) (string, bool) {
	if isGoMailAuthError(err) {
		if code := smtpErrorCode(err); code > 0 {
			return fmt.Sprintf("smtp authentication failed (%d)", code), true
		}

		return "smtp authentication failed", true
	}

	if code := smtpAuthStatusCode(step, err); code > 0 {
		return fmt.Sprintf("smtp authentication failed (%d)", code), true
	}

	return "", false
}

func isGoMailAuthError(err error) bool {
	for _, target := range authSentinelErrors {
		if errors.Is(err, target) {
			return true
		}
	}

	msg := err.Error()
	return strings.HasPrefix(msg, "SMTP AUTH failed:") ||
		msg == "server does not support SMTP AUTH" ||
		strings.HasPrefix(msg, "unsupported SMTP AUTH type ")
}

func smtpErrorCode(err error) int {
	var tpErr *textproto.Error
	if errors.As(err, &tpErr) && tpErr.Code > 0 {
		return tpErr.Code
	}

	var sendErr *gomail.SendError
	if errors.As(err, &sendErr) && sendErr.ErrorCode() > 0 {
		return sendErr.ErrorCode()
	}

	return 0
}

func smtpAuthStatusCode(step string, err error) int {
	var sendErr *gomail.SendError
	if errors.As(err, &sendErr) {
		if code := sendErr.ErrorCode(); isAuthStatusCode(code) {
			return code
		}
	}

	var tpErr *textproto.Error
	if errors.As(err, &tpErr) {
		// 454 during STARTTLS means "TLS not available", not an auth failure.
		if tpErr.Code == 454 && step == dialStep {
			return 0
		}
		if isAuthStatusCode(tpErr.Code) {
			return tpErr.Code
		}
	}

	return 0
}

func isAuthStatusCode(code int) bool {
	switch code {
	case 454, 530, 534, 535, 538:
		return true
	default:
		return false
	}
}

func redactSMTPAuthSecrets(text string, smtp domain.SMTPSettings) string {
	secrets := smtpAuthSecrets(smtp)
	if len(secrets) == 0 {
		return text
	}

	pairs := make([]string, 0, len(secrets)*2)
	for _, secret := range secrets {
		pairs = append(pairs, secret, redactedMarker)
	}

	return strings.NewReplacer(pairs...).Replace(text)
}

func smtpAuthSecrets(smtp domain.SMTPSettings) []string {
	password := smtpPassword(smtp)
	if password == "" {
		return nil
	}

	user := smtpUsername(smtp)
	seen := map[string]struct{}{password: {}}
	candidates := []string{password}

	candidates = appendEncodedSecrets(candidates, seen, []byte(password))
	candidates = appendEncodedSecrets(candidates, seen, []byte("\x00"+user+"\x00"+password))
	if user != "" {
		candidates = appendEncodedSecrets(candidates, seen, []byte(user+"\x00"+user+"\x00"+password))
	}

	// Replace longer encoded blobs before shorter substrings or unpadded variants.
	slices.SortFunc(candidates, func(a, b string) int {
		if len(a) != len(b) {
			return cmp.Compare(len(b), len(a))
		}
		return cmp.Compare(a, b)
	})

	return candidates
}

func appendEncodedSecrets(candidates []string, seen map[string]struct{}, blob []byte) []string {
	for _, enc := range base64Encodings {
		encoded := enc.EncodeToString(blob)
		if encoded == "" {
			continue
		}
		if _, exists := seen[encoded]; exists {
			continue
		}
		seen[encoded] = struct{}{}
		candidates = append(candidates, encoded)
	}

	return candidates
}

func smtpUsername(smtp domain.SMTPSettings) string {
	if smtp.User == nil {
		return ""
	}

	return strings.TrimSpace(*smtp.User)
}

func smtpPassword(smtp domain.SMTPSettings) string {
	if smtp.Password == nil {
		return ""
	}

	return *smtp.Password
}
