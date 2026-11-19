package mail

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"reader/internal/domain"
)

type capturedMail struct {
	from   string
	rcptTo []string
	data   string
}

type parsedMail struct {
	subject        string
	from           string
	to             string
	attachmentName string
	attachmentType string
	attachment     []byte
}

func TestSendEPUBImplicitTLS(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	server := &smtpServer{
		tlsConfig:   serverTLS,
		implicitTLS: true,
		authUser:    "reader",
		authPass:    "smtp-secret",
		messages:    make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	settings := kindleSettings(t, server.address, domain.SMTPSecurityTLS, "reader", "smtp-secret")
	book := domain.EPUBBook{
		Title:        "Liubai 2026-11-19",
		Filename:     "liubai-2026-11-19.epub",
		Data:         []byte("PK\x03\x04epub bytes \x00\x01\x02"),
		ArticleCount: 3,
	}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	if err := sender.SendEPUB(context.Background(), settings, book); err != nil {
		t.Fatalf("SendEPUB() error = %v", err)
	}

	message := receiveMail(t, server.messages)
	assertEPUBDelivery(t, message, settings, book, book.Title)
}

func TestSendEPUBSTARTTLS(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	server := &smtpServer{
		tlsConfig: serverTLS,
		authUser:  "reader",
		authPass:  "smtp-secret",
		messages:  make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	settings := kindleSettings(t, server.address, domain.SMTPSecuritySTARTTLS, "reader", "smtp-secret")
	book := domain.EPUBBook{
		Title:    "Liubai 2026-11-20",
		Filename: "liubai-2026-11-20.epub",
		Data:     []byte("PK\x03\x04starttls epub"),
	}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	if err := sender.SendEPUB(context.Background(), settings, book); err != nil {
		t.Fatalf("SendEPUB() error = %v", err)
	}

	if !server.startTLS.Load() {
		t.Error("smtp server never observed a STARTTLS upgrade")
	}

	message := receiveMail(t, server.messages)
	assertEPUBDelivery(t, message, settings, book, book.Title)
}

func TestSendEPUBIgnoresCloseFailureAfterAcceptance(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	server := &smtpServer{
		tlsConfig:      serverTLS,
		implicitTLS:    true,
		closeAfterData: true,
		messages:       make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	settings := kindleSettings(t, server.address, domain.SMTPSecurityTLS, "", "")
	book := domain.EPUBBook{
		Title:    "Liubai 2026-11-22",
		Filename: "liubai-2026-11-22.epub",
		Data:     []byte("PK\x03\x04accepted epub"),
	}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	if err := sender.SendEPUB(context.Background(), settings, book); err != nil {
		t.Fatalf("SendEPUB() error = %v, want nil after the server accepted DATA", err)
	}

	message := receiveMail(t, server.messages)
	assertEPUBDelivery(t, message, settings, book, book.Title)
}

func TestSendEPUBSTARTTLSKeepsConfiguredPort(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	server := &smtpServer{
		tlsConfig: serverTLS,
		messages:  make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	settings := kindleSettings(t, server.address, domain.SMTPSecuritySTARTTLS, "", "")
	settings.SMTPPort = 25
	book := domain.EPUBBook{
		Title:    "Liubai 2026-11-23",
		Filename: "liubai-2026-11-23.epub",
		Data:     []byte("PK\x03\x04starttls port"),
	}

	var mu sync.Mutex
	var dialedAddress string
	dialContext := func(ctx context.Context, network, address string) (net.Conn, error) {
		mu.Lock()
		dialedAddress = address
		mu.Unlock()

		var dialer net.Dialer
		return dialer.DialContext(ctx, network, server.address)
	}

	sender := NewSender(Config{Timeout: 5 * time.Second, DialContext: dialContext, TLSConfig: clientTLS})
	if err := sender.SendEPUB(context.Background(), settings, book); err != nil {
		t.Fatalf("SendEPUB() error = %v", err)
	}

	mu.Lock()
	gotAddress := dialedAddress
	mu.Unlock()

	if want := "127.0.0.1:25"; gotAddress != want {
		t.Errorf("dial address = %q, want %q", gotAddress, want)
	}

	if !server.startTLS.Load() {
		t.Error("smtp server never observed a STARTTLS upgrade")
	}

	message := receiveMail(t, server.messages)
	assertEPUBDelivery(t, message, settings, book, book.Title)
}

func TestSendEPUBEmptyTitleFallsBackToDefaultSubject(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	server := &smtpServer{
		tlsConfig:   serverTLS,
		implicitTLS: true,
		messages:    make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	settings := kindleSettings(t, server.address, domain.SMTPSecurityTLS, "", "")
	book := domain.EPUBBook{
		Filename: "liubai-2026-11-21.epub",
		Data:     []byte("PK\x03\x04untitled epubs"),
	}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	if err := sender.SendEPUB(context.Background(), settings, book); err != nil {
		t.Fatalf("SendEPUB() error = %v", err)
	}

	message := receiveMail(t, server.messages)
	assertEPUBDelivery(t, message, settings, book, defaultSubject)
}

func TestSendEPUBAuthFailureRedactsPassword(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	password := "sup3r-s3cret-password"
	server := &smtpServer{
		tlsConfig:   serverTLS,
		implicitTLS: true,
		authUser:    "reader",
		authPass:    password,
		rejectAuth:  true,
		messages:    make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	settings := kindleSettings(t, server.address, domain.SMTPSecurityTLS, "reader", password)
	book := domain.EPUBBook{Title: "Liubai", Filename: "liubai.epub", Data: []byte("PK\x03\x04")}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	err := sender.SendEPUB(context.Background(), settings, book)
	if err == nil {
		t.Fatal("SendEPUB() error = nil, want authentication failure")
	}

	if strings.Contains(err.Error(), password) {
		t.Errorf("SendEPUB() error = %q, must not contain the SMTP password", err)
	}

	if !strings.Contains(err.Error(), "535") {
		t.Errorf("SendEPUB() error = %q, want an smtp 535 rejection", err)
	}
}

func TestSendEPUBMessageRejected(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	password := "sup3r-s3cret-password"
	server := &smtpServer{
		tlsConfig:   serverTLS,
		implicitTLS: true,
		authUser:    "reader",
		authPass:    password,
		rejectData:  true,
		messages:    make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	settings := kindleSettings(t, server.address, domain.SMTPSecurityTLS, "reader", password)
	book := domain.EPUBBook{Title: "Liubai", Filename: "liubai.epub", Data: []byte("PK\x03\x04")}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	err := sender.SendEPUB(context.Background(), settings, book)
	if err == nil {
		t.Fatal("SendEPUB() error = nil, want message rejection")
	}

	if strings.Contains(err.Error(), password) {
		t.Errorf("SendEPUB() error = %q, must not contain the SMTP password", err)
	}

	if !strings.Contains(err.Error(), "550") {
		t.Errorf("SendEPUB() error = %q, want an smtp 550 rejection", err)
	}
}

func TestSendEPUBUnsupportedSecurity(t *testing.T) {
	settings := domain.KindleSettings{
		KindleEmail:  "reader@kindle.com",
		SenderEmail:  "sender@example.com",
		SMTPHost:     "127.0.0.1",
		SMTPPort:     2525,
		SMTPSecurity: domain.SMTPSecurity("ssl"),
	}
	book := domain.EPUBBook{Title: "Liubai", Filename: "liubai.epub", Data: []byte("PK\x03\x04")}

	sender := NewSender(Config{})
	err := sender.SendEPUB(context.Background(), settings, book)
	if err == nil {
		t.Fatal("SendEPUB() error = nil, want unsupported security error")
	}

	if !strings.Contains(err.Error(), "unsupported smtp security") {
		t.Errorf("SendEPUB() error = %q, want unsupported security error", err)
	}
}

func assertEPUBDelivery(
	t *testing.T,
	message capturedMail,
	settings domain.KindleSettings,
	book domain.EPUBBook,
	subject string,
) {
	t.Helper()

	if want := "<" + settings.SenderEmail + ">"; message.from != want {
		t.Errorf("MAIL FROM = %q, want %q", message.from, want)
	}

	if want := "<" + settings.KindleEmail + ">"; len(message.rcptTo) != 1 || message.rcptTo[0] != want {
		t.Errorf("RCPT TO = %v, want [%q]", message.rcptTo, want)
	}

	parsed := parseMail(t, message.data)
	if parsed.subject != subject {
		t.Errorf("Subject = %q, want %q", parsed.subject, subject)
	}

	if parsed.from != settings.SenderEmail {
		t.Errorf("From = %q, want %q", parsed.from, settings.SenderEmail)
	}

	if parsed.to != settings.KindleEmail {
		t.Errorf("To = %q, want %q", parsed.to, settings.KindleEmail)
	}

	if want := string(epubContentType); parsed.attachmentType != want {
		t.Errorf("attachment content type = %q, want %q", parsed.attachmentType, want)
	}

	if parsed.attachmentName != book.Filename {
		t.Errorf("attachment filename = %q, want %q", parsed.attachmentName, book.Filename)
	}

	if !bytes.Equal(parsed.attachment, book.Data) {
		t.Errorf("attachment data = %q, want %q", parsed.attachment, book.Data)
	}
}

func parseMail(t *testing.T, raw string) parsedMail {
	t.Helper()

	message, err := netmail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatalf("read message: %v", err)
	}

	subject, err := new(mime.WordDecoder).DecodeHeader(message.Header.Get("Subject"))
	if err != nil {
		t.Fatalf("decode subject: %v", err)
	}

	from, err := netmail.ParseAddress(message.Header.Get("From"))
	if err != nil {
		t.Fatalf("parse From header: %v", err)
	}

	to, err := netmail.ParseAddress(message.Header.Get("To"))
	if err != nil {
		t.Fatalf("parse To header: %v", err)
	}

	mediaType, params, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("parse Content-Type header: %v", err)
	}

	if mediaType != "multipart/mixed" {
		t.Fatalf("Content-Type = %q, want multipart/mixed", mediaType)
	}

	parts := multipart.NewReader(message.Body, params["boundary"])
	for {
		part, err := parts.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}

		if err != nil {
			t.Fatalf("read mime part: %v", err)
		}

		partType, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
		if err != nil {
			t.Fatalf("parse part Content-Type: %v", err)
		}

		if partType != string(epubContentType) {
			continue
		}

		_, disposition, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		if err != nil {
			t.Fatalf("parse Content-Disposition: %v", err)
		}

		data, err := decodePart(part)
		if err != nil {
			t.Fatalf("decode attachment: %v", err)
		}

		return parsedMail{
			subject:        subject,
			from:           from.Address,
			to:             to.Address,
			attachmentName: disposition["filename"],
			attachmentType: partType,
			attachment:     data,
		}
	}

	t.Fatalf("no %s attachment found in message", epubContentType)
	return parsedMail{}
}

func decodePart(part *multipart.Part) ([]byte, error) {
	switch strings.ToLower(strings.TrimSpace(part.Header.Get("Content-Transfer-Encoding"))) {
	case "base64":
		return io.ReadAll(base64.NewDecoder(base64.StdEncoding, part))
	case "quoted-printable":
		return io.ReadAll(quotedprintable.NewReader(part))
	default:
		return io.ReadAll(part)
	}
}

func receiveMail(t *testing.T, messages <-chan capturedMail) capturedMail {
	t.Helper()

	select {
	case message := <-messages:
		return message
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for the smtp message")
		return capturedMail{}
	}
}

func kindleSettings(
	t *testing.T,
	address string,
	security domain.SMTPSecurity,
	user string,
	password string,
) domain.KindleSettings {
	t.Helper()

	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatalf("split smtp address: %v", err)
	}

	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse smtp port: %v", err)
	}

	settings := domain.KindleSettings{
		KindleEmail:  "reader@kindle.com",
		SenderEmail:  "sender@example.com",
		SMTPHost:     host,
		SMTPPort:     port,
		SMTPSecurity: security,
	}

	if user != "" {
		settings.SMTPUser = &user
		settings.SMTPPassword = &password
	}

	return settings
}

func newTestTLSConfigs(t *testing.T) (*tls.Config, *tls.Config) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}

	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}

	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}

	roots := x509.NewCertPool()
	roots.AddCert(parsed)

	serverTLS := &tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}},
		MinVersion:   tls.VersionTLS12,
	}
	clientTLS := &tls.Config{
		RootCAs:    roots,
		ServerName: "127.0.0.1",
		MinVersion: tls.VersionTLS12,
	}

	return serverTLS, clientTLS
}

type smtpServer struct {
	address        string
	tlsConfig      *tls.Config
	implicitTLS    bool
	authUser       string
	authPass       string
	rejectAuth     bool
	rejectData     bool
	closeAfterData bool
	messages       chan capturedMail
	startTLS       atomic.Bool
	wg             sync.WaitGroup
}

func startSMTPServer(t *testing.T, server *smtpServer) {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	server.address = listener.Addr().String()
	server.wg.Add(1)
	go func() {
		defer server.wg.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}

			server.wg.Add(1)
			go func() {
				defer server.wg.Done()
				defer conn.Close()

				if err := server.serveConnection(conn); err != nil {
					t.Logf("smtp connection: %v", err)
				}
			}()
		}
	}()

	t.Cleanup(func() {
		_ = listener.Close()
		server.wg.Wait()
	})
}

func (s *smtpServer) serveConnection(conn net.Conn) error {
	if s.implicitTLS {
		tlsConn := tls.Server(conn, s.tlsConfig)
		if err := tlsConn.Handshake(); err != nil {
			return err
		}

		conn = tlsConn
	}

	session := &smtpSession{
		server: s,
		conn:   conn,
		reader: bufio.NewReader(conn),
		writer: bufio.NewWriter(conn),
	}

	if err := session.reply(220, "127.0.0.1 ESMTP"); err != nil {
		return err
	}

	return session.run()
}

type smtpSession struct {
	server    *smtpServer
	conn      net.Conn
	reader    *bufio.Reader
	writer    *bufio.Writer
	encrypted bool
	mailFrom  string
	rcptTo    []string
}

func (s *smtpSession) run() error {
	for {
		line, err := s.reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}

			return err
		}

		done, err := s.handleCommand(strings.TrimRight(line, "\r\n"))
		if err != nil {
			return err
		}

		if done {
			return nil
		}
	}
}

func (s *smtpSession) handleCommand(line string) (bool, error) {
	upper := strings.ToUpper(line)

	switch {
	case strings.HasPrefix(upper, "EHLO "):
		return false, s.replyEHLO()
	case strings.HasPrefix(upper, "HELO "):
		return false, s.reply(250, "127.0.0.1")
	case strings.HasPrefix(upper, "STARTTLS"):
		return false, s.startTLS()
	case strings.HasPrefix(upper, "AUTH PLAIN"):
		return false, s.authenticate(line)
	case strings.HasPrefix(upper, "MAIL FROM:"):
		s.mailFrom = strings.TrimSpace(line[len("MAIL FROM:"):])
		return false, s.reply(250, "OK")
	case strings.HasPrefix(upper, "RCPT TO:"):
		s.rcptTo = append(s.rcptTo, strings.TrimSpace(line[len("RCPT TO:"):]))
		return false, s.reply(250, "OK")
	case upper == "DATA":
		return false, s.receiveData()
	case upper == "RSET":
		s.mailFrom = ""
		s.rcptTo = nil
		return false, s.reply(250, "OK")
	case upper == "NOOP":
		return false, s.reply(250, "OK")
	case upper == "QUIT":
		if err := s.reply(221, "Bye"); err != nil {
			return true, err
		}

		return true, nil
	default:
		return false, s.reply(501, "Syntax error")
	}
}

func (s *smtpSession) replyEHLO() error {
	lines := []string{"127.0.0.1", "AUTH PLAIN"}
	if !s.encrypted && s.server.tlsConfig != nil {
		lines = append(lines, "STARTTLS")
	}

	return s.replyMultiline(250, lines)
}

func (s *smtpSession) startTLS() error {
	if s.server.tlsConfig == nil {
		return s.reply(454, "TLS not available")
	}

	if err := s.reply(220, "Ready to start TLS"); err != nil {
		return err
	}

	tlsConn := tls.Server(s.conn, s.server.tlsConfig)
	if err := tlsConn.Handshake(); err != nil {
		return err
	}

	s.conn = tlsConn
	s.reader = bufio.NewReader(tlsConn)
	s.writer = bufio.NewWriter(tlsConn)
	s.encrypted = true
	s.server.startTLS.Store(true)

	return nil
}

func (s *smtpSession) authenticate(line string) error {
	fields := strings.Fields(line)
	if len(fields) != 3 {
		return s.reply(501, "Syntax error")
	}

	credentials, err := base64.StdEncoding.DecodeString(fields[2])
	if err != nil {
		return s.reply(501, "Invalid credentials")
	}

	parts := strings.Split(string(credentials), "\x00")
	details := line
	if len(parts) == 3 {
		details = parts[1] + ":" + parts[2]
	}

	if s.server.rejectAuth || len(parts) != 3 || parts[1] != s.server.authUser || parts[2] != s.server.authPass {
		return s.reply(535, "Authentication failed: "+details)
	}

	return s.reply(235, "Authentication successful")
}

func (s *smtpSession) receiveData() error {
	if err := s.reply(354, "End data with <CR><LF>.<CR><LF>"); err != nil {
		return err
	}

	var data strings.Builder
	for {
		line, err := s.reader.ReadString('\n')
		if err != nil {
			return err
		}

		if line == ".\r\n" {
			break
		}

		data.WriteString(strings.TrimPrefix(line, "."))
	}

	if s.server.rejectData {
		return s.reply(550, "Message rejected")
	}

	s.server.messages <- capturedMail{
		from:   s.mailFrom,
		rcptTo: append([]string(nil), s.rcptTo...),
		data:   data.String(),
	}

	if err := s.reply(250, "OK: queued"); err != nil {
		return err
	}

	if s.server.closeAfterData {
		return s.conn.Close()
	}

	return nil
}

func (s *smtpSession) reply(code int, message string) error {
	if _, err := fmt.Fprintf(s.writer, "%d %s\r\n", code, message); err != nil {
		return err
	}

	return s.writer.Flush()
}

func (s *smtpSession) replyMultiline(code int, lines []string) error {
	for i, line := range lines {
		separator := "-"
		if i == len(lines)-1 {
			separator = " "
		}

		if _, err := fmt.Fprintf(s.writer, "%d%s%s\r\n", code, separator, line); err != nil {
			return err
		}
	}

	return s.writer.Flush()
}
