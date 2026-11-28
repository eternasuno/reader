package mail

import (
	"bufio"
	"bytes"
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

func assertEPUBDelivery(
	t *testing.T,
	message capturedMail,
	delivery domain.KindleDelivery,
	book domain.EPUBBook,
	subject string,
) {
	t.Helper()

	if want := "<" + delivery.SMTP.SenderEmail + ">"; message.from != want {
		t.Errorf("MAIL FROM = %q, want %q", message.from, want)
	}

	if want := "<" + delivery.KindleEmail + ">"; len(message.rcptTo) != 1 || message.rcptTo[0] != want {
		t.Errorf("RCPT TO = %v, want [%q]", message.rcptTo, want)
	}

	parsed := parseMail(t, message.data)
	if parsed.subject != subject {
		t.Errorf("Subject = %q, want %q", parsed.subject, subject)
	}

	if parsed.from != delivery.SMTP.SenderEmail {
		t.Errorf("From = %q, want %q", parsed.from, delivery.SMTP.SenderEmail)
	}

	if parsed.to != delivery.KindleEmail {
		t.Errorf("To = %q, want %q", parsed.to, delivery.KindleEmail)
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

func kindleDelivery(
	t *testing.T,
	address string,
	security domain.SMTPSecurity,
	user string,
	password string,
) domain.KindleDelivery {
	t.Helper()

	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatalf("split smtp address: %v", err)
	}

	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse smtp port: %v", err)
	}

	delivery := domain.KindleDelivery{
		SMTP: domain.SMTPSettings{
			SenderEmail: "sender@example.com",
			Host:        host,
			Port:        port,
			Security:    security,
		},
		KindleEmail: "reader@kindle.com",
	}

	if user != "" {
		delivery.SMTP.User = &user
		delivery.SMTP.Password = &password
	}

	return delivery
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
	address           string
	tlsConfig         *tls.Config
	implicitTLS       bool
	authUser          string
	authPass          string
	omitAuthExt       bool
	rejectAuth        bool
	echoRawAuth       bool
	authRejectCode    int
	rejectData        bool
	rejectDataCode    int
	rejectDataMessage string
	closeAfterData    bool
	greetingWait      time.Duration
	oversizedGreet    bool
	enteredData       chan struct{}
	stallData         <-chan struct{}
	messages          chan capturedMail
	startTLS          atomic.Bool
	wg                sync.WaitGroup
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

	if s.greetingWait > 0 {
		time.Sleep(s.greetingWait)
	}

	if s.oversizedGreet {
		_ = session.replyMultiline(220, []string{strings.Repeat("A", 4096), "127.0.0.1 ESMTP"})
		return nil
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
	lines := []string{"127.0.0.1"}
	if !s.server.omitAuthExt {
		lines = append(lines, "AUTH PLAIN")
	}
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
	if !s.server.echoRawAuth && len(parts) == 3 {
		details = parts[1] + ":" + parts[2]
	}

	if s.server.rejectAuth || len(parts) != 3 || parts[1] != s.server.authUser || parts[2] != s.server.authPass {
		code := s.server.authRejectCode
		if code == 0 {
			code = 535
		}
		return s.reply(code, "Authentication failed: "+details)
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

	if s.server.enteredData != nil {
		close(s.server.enteredData)
	}

	if s.server.stallData != nil {
		<-s.server.stallData
		return nil
	}

	if s.server.rejectData {
		code := s.server.rejectDataCode
		if code == 0 {
			code = 550
		}
		message := s.server.rejectDataMessage
		if message == "" {
			message = "Message rejected"
		}
		return s.reply(code, message)
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
