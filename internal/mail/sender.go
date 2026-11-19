package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
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

func (s *Sender) SendEPUB(ctx context.Context, cfg domain.KindleSettings, book domain.EPUBBook) error {
	message, err := buildMessage(cfg, book)
	if err != nil {
		return sanitizedError(cfg, "build message", err)
	}

	client, err := s.newClient(cfg)
	if err != nil {
		return sanitizedError(cfg, "create smtp client", err)
	}

	if err := client.DialWithContext(ctx); err != nil {
		return sanitizedError(cfg, "dial smtp server", err)
	}

	sendErr := client.Send(message)
	_ = client.Close()

	if message.IsDelivered() {
		return nil
	}

	if sendErr != nil {
		return sanitizedError(cfg, "send epub mail", sendErr)
	}

	if err := message.SendError(); err != nil {
		return sanitizedError(cfg, "send epub mail", err)
	}

	return nil
}

func (s *Sender) newClient(cfg domain.KindleSettings) (*gomail.Client, error) {
	options, err := s.clientOptions(cfg)
	if err != nil {
		return nil, err
	}

	return gomail.NewClient(cfg.SMTPHost, options...)
}

func (s *Sender) clientOptions(cfg domain.KindleSettings) ([]gomail.Option, error) {
	options := []gomail.Option{
		gomail.WithPort(cfg.SMTPPort),
		gomail.WithTimeout(s.timeout),
	}

	switch cfg.SMTPSecurity {
	case domain.SMTPSecurityTLS:
		options = append(options, gomail.WithSSL())
	case domain.SMTPSecuritySTARTTLS:
		options = append(options, gomail.WithTLSPolicy(gomail.TLSMandatory))
	default:
		return nil, fmt.Errorf("unsupported smtp security %q", cfg.SMTPSecurity)
	}

	if username := smtpUsername(cfg); username != "" {
		options = append(options,
			gomail.WithUsername(username),
			gomail.WithPassword(smtpPassword(cfg)),
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

func buildMessage(cfg domain.KindleSettings, book domain.EPUBBook) (*gomail.Msg, error) {
	subject := book.Title
	if subject == "" {
		subject = defaultSubject
	}

	message := gomail.NewMsg()
	if err := message.From(cfg.SenderEmail); err != nil {
		return nil, err
	}

	if err := message.To(cfg.KindleEmail); err != nil {
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

func sanitizedError(cfg domain.KindleSettings, step string, err error) error {
	text := domain.SanitizeErrorText(err.Error())
	if password := smtpPassword(cfg); password != "" {
		text = strings.ReplaceAll(text, password, redactedMarker)
	}

	return fmt.Errorf("send kindle epub: %s: %s", step, text)
}

func smtpUsername(cfg domain.KindleSettings) string {
	if cfg.SMTPUser == nil {
		return ""
	}

	return strings.TrimSpace(*cfg.SMTPUser)
}

func smtpPassword(cfg domain.KindleSettings) string {
	if cfg.SMTPPassword == nil {
		return ""
	}

	return *cfg.SMTPPassword
}
