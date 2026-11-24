package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/textproto"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	gomail "github.com/wneessen/go-mail"

	"reader/internal/domain"
)

const (
	defaultTimeout      = 3 * time.Minute
	defaultMaxReadBytes = 1 << 20 // 1 MiB cap on server responses per message
	epubContentType     = gomail.ContentType("application/epub+zip")
	defaultSubject      = "Lantern"
	dialStep            = "dial smtp server"
	sendStep            = "send epub mail"
	minValidSMTPCode    = 400
	maxValidSMTPCode    = 599
)

var (
	errUnsupportedSecurity = errors.New("unsupported smtp security")
	errInvalidAddress      = errors.New("invalid email address")
	errSMTPReplyTooLarge   = errors.New("smtp reply exceeded limit")

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

	preferredTLSAuthOrder = []gomail.SMTPAuthType{
		gomail.SMTPAuthSCRAMSHA256PLUS,
		gomail.SMTPAuthSCRAMSHA256,
		gomail.SMTPAuthSCRAMSHA1PLUS,
		gomail.SMTPAuthSCRAMSHA1,
		gomail.SMTPAuthNTLM,
		gomail.SMTPAuthCramMD5,
		gomail.SMTPAuthPlain,
		gomail.SMTPAuthLogin,
	}
)

type Config struct {
	Timeout     time.Duration
	DialContext gomail.DialContextFunc
	TLSConfig   *tls.Config
}

type Sender struct {
	timeout      time.Duration
	maxReadBytes int64
	dialContext  gomail.DialContextFunc
	tlsConfig    *tls.Config
}

var _ domain.MailSender = (*Sender)(nil)

func NewSender(cfg Config) *Sender {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}

	return &Sender{
		timeout:      timeout,
		maxReadBytes: defaultMaxReadBytes,
		dialContext:  cfg.DialContext,
		tlsConfig:    cfg.TLSConfig,
	}
}

func (s *Sender) SendEPUB(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
	message, err := buildMessage(delivery, book)
	if err != nil {
		return sanitizedError("build message", err)
	}

	msgCtx, cancel := context.WithDeadline(ctx, time.Now().Add(s.timeout))
	defer cancel()

	tracker := &connTracker{}
	stopWatch := context.AfterFunc(msgCtx, tracker.closeAll)
	defer func() {
		stopWatch()
		tracker.closeAll()
	}()

	client, err := s.newClient(delivery.SMTP, tracker)
	if err != nil {
		return sanitizedError("create smtp client", err)
	}

	if err := client.DialWithContext(msgCtx); err != nil {
		return sanitizedError(dialStep, resolveSendFailure(msgCtx, tracker, err))
	}

	sendErr := client.Send(message)
	_ = client.Close()

	if message.IsDelivered() {
		return nil
	}

	if sendErr != nil {
		return sanitizedError(sendStep, resolveSendFailure(msgCtx, tracker, sendErr))
	}

	if err := message.SendError(); err != nil {
		return sanitizedError(sendStep, resolveSendFailure(msgCtx, tracker, err))
	}

	return nil
}

func resolveSendFailure(msgCtx context.Context, tracker *connTracker, err error) error {
	if tracker.replyOverflow.Load() {
		return errSMTPReplyTooLarge
	}

	if ctxErr := msgCtx.Err(); ctxErr != nil {
		return ctxErr
	}

	return err
}

func (s *Sender) newClient(smtp domain.SMTPSettings, tracker *connTracker) (*gomail.Client, error) {
	options, err := s.clientOptions(smtp, tracker)
	if err != nil {
		return nil, err
	}

	return gomail.NewClient(smtp.Host, options...)
}

func (s *Sender) clientOptions(smtp domain.SMTPSettings, tracker *connTracker) ([]gomail.Option, error) {
	options := []gomail.Option{
		gomail.WithPort(smtp.Port),
		gomail.WithTimeout(s.timeout),
		gomail.WithDialContextFunc(s.makeDialContext(smtp, tracker)),
	}

	switch smtp.Security {
	case domain.SMTPSecurityTLS:
		options = append(options, gomail.WithSSL())
	case domain.SMTPSecuritySTARTTLS:
		options = append(options, gomail.WithTLSPolicy(gomail.TLSMandatory))
	default:
		return nil, errUnsupportedSecurity
	}

	if username := smtpUsername(smtp); username != "" {
		options = append(options,
			gomail.WithUsername(username),
			gomail.WithPassword(smtpPassword(smtp)),
			// Explicit encrypted preference order avoids go-mail's DialContextFunc
			// implicit-TLS flag quirk where AutoDiscover drops PLAIN/LOGIN.
			gomail.WithOpportunisticSMTPAuth(preferredTLSAuthOrder...),
		)
	}

	if s.tlsConfig != nil {
		options = append(options, gomail.WithTLSConfig(s.tlsConfig))
	}

	return options, nil
}

func (s *Sender) makeDialContext(smtp domain.SMTPSettings, tracker *connTracker) gomail.DialContextFunc {
	baseDial := s.dialContext
	if baseDial == nil {
		var dialer net.Dialer
		baseDial = dialer.DialContext
	}

	return func(dialCtx context.Context, network, addr string) (net.Conn, error) {
		rawConn, err := baseDial(dialCtx, network, addr)
		if err != nil {
			return nil, err
		}

		if !tracker.track(rawConn) {
			return nil, context.Canceled
		}

		return s.wrapSMTPConn(dialCtx, smtp, tracker, rawConn)
	}
}

func (s *Sender) wrapSMTPConn(
	dialCtx context.Context,
	smtp domain.SMTPSettings,
	tracker *connTracker,
	rawConn net.Conn,
) (net.Conn, error) {
	limited := &readLimitConn{
		Conn:      rawConn,
		remaining: s.maxReadBytes,
		overflow:  &tracker.replyOverflow,
	}
	if smtp.Security != domain.SMTPSecurityTLS {
		return limited, nil
	}

	if _, alreadyTLS := rawConn.(*tls.Conn); alreadyTLS {
		return limited, nil
	}

	tlsConn := tls.Client(limited, s.tlsConfigForHost(smtp.Host))
	if err := tlsConn.HandshakeContext(dialCtx); err != nil {
		_ = rawConn.Close()
		return nil, err
	}

	return tlsConn, nil
}

func (s *Sender) tlsConfigForHost(host string) *tls.Config {
	if s.tlsConfig != nil {
		cfg := s.tlsConfig.Clone()
		if cfg.ServerName == "" {
			cfg.ServerName = host
		}

		return cfg
	}

	return &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	}
}

func buildMessage(delivery domain.KindleDelivery, book domain.EPUBBook) (*gomail.Msg, error) {
	subject := book.Title
	if subject == "" {
		subject = defaultSubject
	}

	message := gomail.NewMsg()
	if err := message.From(delivery.SMTP.SenderEmail); err != nil {
		return nil, errInvalidAddress
	}

	if err := message.To(delivery.KindleEmail); err != nil {
		return nil, errInvalidAddress
	}

	message.Subject(subject)
	message.SetBodyString(gomail.TypeTextPlain, subject)
	message.AttachReadSeeker(
		book.Filename,
		bytes.NewReader(book.Data),
		gomail.WithFileContentType(epubContentType),
	)

	return message, nil
}

type connTracker struct {
	mu            sync.Mutex
	closed        bool
	conns         []net.Conn
	replyOverflow atomic.Bool
}

func (t *connTracker) track(conn net.Conn) bool {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		_ = conn.Close()
		return false
	}

	t.conns = append(t.conns, conn)
	t.mu.Unlock()

	return true
}

func (t *connTracker) closeAll() {
	t.mu.Lock()
	t.closed = true
	conns := t.conns
	t.conns = nil
	t.mu.Unlock()

	for _, conn := range conns {
		_ = conn.Close()
	}
}

type readLimitConn struct {
	net.Conn
	mu        sync.Mutex
	remaining int64
	overflow  *atomic.Bool
}

func (c *readLimitConn) Read(p []byte) (int, error) {
	c.mu.Lock()
	remaining := c.remaining
	c.mu.Unlock()

	if remaining <= 0 {
		c.overflow.Store(true)
		return 0, errSMTPReplyTooLarge
	}

	buf := p
	if int64(len(buf)) > remaining {
		buf = buf[:remaining]
	}

	n, err := c.Conn.Read(buf)
	if n > 0 {
		c.mu.Lock()
		c.remaining -= int64(n)
		c.mu.Unlock()
	}

	return n, err
}

func sanitizedError(step string, err error) error {
	if summary, ok := authFailureSummary(step, err); ok {
		return fmt.Errorf("send kindle epub: %s: %s", step, summary)
	}

	return fmt.Errorf("send kindle epub: %s: %s", step, classifyNonAuthError(err))
}

func authFailureSummary(step string, err error) (string, bool) {
	if isGoMailAuthError(err) {
		if code := validSMTPCode(smtpErrorCode(err)); code > 0 {
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
	if errors.As(err, &tpErr) {
		return tpErr.Code
	}

	var sendErr *gomail.SendError
	if errors.As(err, &sendErr) {
		return sendErr.ErrorCode()
	}

	return 0
}

func smtpAuthStatusCode(step string, err error) int {
	code := validSMTPCode(smtpErrorCode(err))
	if code == 0 {
		return 0
	}

	// 454 during STARTTLS means "TLS not available", not an auth failure.
	if code == 454 && step == dialStep {
		return 0
	}

	if isAuthStatusCode(code) {
		return code
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

func validSMTPCode(code int) int {
	if code >= minValidSMTPCode && code <= maxValidSMTPCode {
		return code
	}

	return 0
}

func classifyNonAuthError(err error) string {
	if label, ok := classifyLocalOrContextError(err); ok {
		return label
	}

	if label, ok := classifyTransportError(err); ok {
		return label
	}

	if label, ok := classifySMTPReplyError(err); ok {
		return label
	}

	return "smtp failure"
}

func classifyLocalOrContextError(err error) (string, bool) {
	switch {
	case errors.Is(err, errSMTPReplyTooLarge):
		return "smtp reply exceeded limit", true
	case errors.Is(err, errUnsupportedSecurity):
		return "unsupported smtp security", true
	case errors.Is(err, errInvalidAddress):
		return "invalid email address", true
	case errors.Is(err, context.DeadlineExceeded):
		return "smtp timeout", true
	case errors.Is(err, context.Canceled):
		return "smtp canceled", true
	default:
		return "", false
	}
}

func classifyTransportError(err error) (string, bool) {
	if isTLSFailure(err) {
		return "tls error", true
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return "network timeout", true
		}

		return "network error", true
	}

	if errors.Is(err, gomail.ErrNoActiveConnection) ||
		errors.Is(err, gomail.ErrDeadlineExtendFailed) ||
		errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrUnexpectedEOF) {
		return "connection closed", true
	}

	return "", false
}

func classifySMTPReplyError(err error) (string, bool) {
	var sendErr *gomail.SendError
	if errors.As(err, &sendErr) {
		label := sendReasonCategory(sendErr.Reason)
		if code := validSMTPCode(sendErr.ErrorCode()); code > 0 {
			return fmt.Sprintf("%s (%d)", label, code), true
		}

		return label, true
	}

	var tpErr *textproto.Error
	if errors.As(err, &tpErr) {
		if code := validSMTPCode(tpErr.Code); code > 0 {
			return fmt.Sprintf("smtp server error (%d)", code), true
		}

		return "smtp server error", true
	}

	return "", false
}

func sendReasonCategory(reason gomail.SendErrReason) string {
	switch reason {
	case gomail.ErrGetSender, gomail.ErrGetRcpts:
		return "invalid email address"
	case gomail.ErrSMTPMailFrom:
		return "smtp sender rejected"
	case gomail.ErrSMTPRcptTo:
		return "smtp recipient rejected"
	case gomail.ErrSMTPData, gomail.ErrSMTPDataClose:
		return "smtp data rejected"
	case gomail.ErrWriteContent:
		return "smtp write failed"
	case gomail.ErrSMTPReset:
		return "smtp reset failed"
	case gomail.ErrConnCheck:
		return "smtp connection check failed"
	case gomail.ErrNoUnencoded:
		return "smtp 8bitmime unsupported"
	default:
		return "smtp send failed"
	}
}

func isTLSFailure(err error) bool {
	var certVerifyErr *tls.CertificateVerificationError
	var recordHeaderErr tls.RecordHeaderError
	var certInvalidErr x509.CertificateInvalidError
	var unknownAuthErr x509.UnknownAuthorityError
	var hostnameErr x509.HostnameError

	return errors.As(err, &certVerifyErr) ||
		errors.As(err, &recordHeaderErr) ||
		errors.As(err, &certInvalidErr) ||
		errors.As(err, &unknownAuthErr) ||
		errors.As(err, &hostnameErr)
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
