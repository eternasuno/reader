package mail

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	gomail "github.com/wneessen/go-mail"
	"reader/internal/domain"
)

func TestSendEPUBImplicitTLS(t *testing.T) {
	for _, tt := range []struct {
		name           string
		security       domain.SMTPSecurity
		user, password string
		port           int
	}{
		{"implicit TLS", domain.SMTPSecurityTLS, "reader", "smtp-secret", 0},
		{"STARTTLS", domain.SMTPSecuritySTARTTLS, "reader", "smtp-secret", 0},
		{"STARTTLS configured port", domain.SMTPSecuritySTARTTLS, "", "", 25},
	} {
		t.Run(tt.name, func(t *testing.T) {
			serverTLS, clientTLS := newTestTLSConfigs(t)
			server := &smtpServer{tlsConfig: serverTLS, implicitTLS: tt.security == domain.SMTPSecurityTLS, authUser: tt.user, authPass: tt.password, messages: make(chan capturedMail, 1)}
			startSMTPServer(t, server)
			delivery := kindleDelivery(t, server.address, tt.security, tt.user, tt.password)
			if tt.port != 0 {
				delivery.SMTP.Port = tt.port
			}
			book := domain.EPUBBook{Title: "Lantern 2026-11-19", Filename: "lantern-2026-11-19.epub", Data: []byte("PK\x03\x04epub bytes \x00\x01\x02"), ArticleCount: 3}
			var mu sync.Mutex
			var dialedAddress string
			dialContext := func(ctx context.Context, network, address string) (net.Conn, error) {
				mu.Lock()
				dialedAddress = address
				mu.Unlock()
				var dialer net.Dialer
				return dialer.DialContext(ctx, network, server.address)
			}
			sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS, DialContext: dialContext})
			if err := sender.SendEPUB(context.Background(), delivery, book); err != nil {
				t.Fatalf("SendEPUB() error = %v", err)
			}
			if tt.port != 0 {
				mu.Lock()
				got := dialedAddress
				mu.Unlock()
				if got != "127.0.0.1:25" {
					t.Errorf("dial address = %q, want 127.0.0.1:25", got)
				}
			}
			if tt.security == domain.SMTPSecuritySTARTTLS && !server.startTLS.Load() {
				t.Error("smtp server never observed a STARTTLS upgrade")
			}
			assertEPUBDelivery(t, receiveMail(t, server.messages), delivery, book, book.Title)
		})
	}
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

	delivery := kindleDelivery(t, server.address, domain.SMTPSecurityTLS, "", "")
	book := domain.EPUBBook{
		Title:    "Lantern 2026-11-22",
		Filename: "lantern-2026-11-22.epub",
		Data:     []byte("PK\x03\x04accepted epub"),
	}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	if err := sender.SendEPUB(context.Background(), delivery, book); err != nil {
		t.Fatalf("SendEPUB() error = %v, want nil after the server accepted DATA", err)
	}

	message := receiveMail(t, server.messages)
	assertEPUBDelivery(t, message, delivery, book, book.Title)
}

func TestSendEPUBAuthFailureStatusCodes(t *testing.T) {
	cases := []struct {
		name      string
		code      int
		plaintext bool
	}{{"454", 454, false}, {"530", 530, false}, {"534", 534, false}, {"535", 535, false}, {"538", 538, false}, {"535 plaintext echo", 535, true}}
	for _, tt := range cases {
		code := tt.code
		t.Run(tt.name, func(t *testing.T) {
			serverTLS, clientTLS := newTestTLSConfigs(t)
			user := "reader"
			password := "sup3r+s3cret/pass?="
			if tt.plaintext {
				password = "sup3r-s3cret-password"
			}
			server := &smtpServer{
				tlsConfig:      serverTLS,
				implicitTLS:    true,
				authUser:       user,
				authPass:       password,
				rejectAuth:     true,
				echoRawAuth:    !tt.plaintext,
				authRejectCode: code,
				messages:       make(chan capturedMail, 1),
			}
			startSMTPServer(t, server)

			delivery := kindleDelivery(t, server.address, domain.SMTPSecurityTLS, user, password)
			book := domain.EPUBBook{Title: "Lantern", Filename: "lantern.epub", Data: []byte("PK\x03\x04")}

			sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
			err := sender.SendEPUB(context.Background(), delivery, book)
			if err == nil {
				t.Fatalf("SendEPUB() error = nil, want %d authentication failure", code)
			}

			want := fmt.Sprintf("send kindle epub: dial smtp server: smtp authentication failed (%d)", code)
			if err.Error() != want {
				t.Errorf("SendEPUB() error = %q, want %q", err.Error(), want)
			}

			assertNoAuthSecrets(t, err.Error(), user, password)
		})
	}

	t.Run("auth_not_advertised", func(t *testing.T) {
		serverTLS, clientTLS := newTestTLSConfigs(t)
		server := &smtpServer{
			tlsConfig:   serverTLS,
			implicitTLS: true,
			omitAuthExt: true,
			messages:    make(chan capturedMail, 1),
		}
		startSMTPServer(t, server)

		delivery := kindleDelivery(t, server.address, domain.SMTPSecurityTLS, "reader", "smtp-secret")
		book := domain.EPUBBook{Title: "Lantern", Filename: "lantern.epub", Data: []byte("PK\x03\x04")}

		sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
		err := sender.SendEPUB(context.Background(), delivery, book)
		if err == nil {
			t.Fatal("SendEPUB() error = nil, want authentication failure")
		}

		want := "send kindle epub: dial smtp server: smtp authentication failed"
		if err.Error() != want {
			t.Errorf("SendEPUB() error = %q, want %q", err.Error(), want)
		}
	})
}

func TestSendEPUBSendStageAuthRejection(t *testing.T) {
	for _, code := range []int{454, 530, 535, 550} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			serverTLS, clientTLS := newTestTLSConfigs(t)
			user := "reader"
			password := "sup3r+s3cret/pass?="
			plainBlob := base64.StdEncoding.EncodeToString([]byte("\x00" + user + "\x00" + password))
			message := "Authentication required: " + plainBlob
			if code == 550 {
				message = "Message rejected with secret-server-echo"
			}
			server := &smtpServer{
				tlsConfig:         serverTLS,
				implicitTLS:       true,
				authUser:          user,
				authPass:          password,
				rejectData:        true,
				rejectDataCode:    code,
				rejectDataMessage: message,
				messages:          make(chan capturedMail, 1),
			}
			startSMTPServer(t, server)

			delivery := kindleDelivery(t, server.address, domain.SMTPSecurityTLS, user, password)
			book := domain.EPUBBook{Title: "Lantern", Filename: "lantern.epub", Data: []byte("PK\x03\x04")}

			sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
			err := sender.SendEPUB(context.Background(), delivery, book)
			if err == nil {
				t.Fatalf("SendEPUB() error = nil, want %d rejection", code)
			}

			want := fmt.Sprintf("send kindle epub: send epub mail: smtp authentication failed (%d)", code)
			if code == 550 {
				want = "send kindle epub: send epub mail: smtp data rejected (550)"
			}
			if err.Error() != want {
				t.Errorf("SendEPUB() error = %q, want %q", err.Error(), want)
			}

			assertNoAuthSecrets(t, err.Error(), user, password)
		})
	}
}

func TestSanitizedErrorAuthAndTypedCategories(t *testing.T) {
	user := "u"
	password := ">>?pass/+"

	t.Run("go_mail_auth_sentinels", func(t *testing.T) {
		for _, sentinel := range []error{
			gomail.ErrPlainAuthNotSupported,
			gomail.ErrNoSupportedAuthDiscovered,
			fmt.Errorf("SMTP AUTH failed: %w", errors.New("unexpected eof "+password)),
		} {
			got := sanitizedError(dialStep, sentinel).Error()
			want := "send kindle epub: dial smtp server: smtp authentication failed"
			if got != want {
				t.Errorf("sanitizedError(%v) = %q, want %q", sentinel, got, want)
			}
		}
	})

	t.Run("starttls_454_not_classified_as_auth_and_drops_server_text", func(t *testing.T) {
		err := &textproto.Error{Code: 454, Msg: "TLS not available"}
		got := sanitizedError(dialStep, err).Error()
		want := "send kindle epub: dial smtp server: smtp server error (454)"
		if got != want {
			t.Errorf("sanitizedError(STARTTLS 454) = %q, want %q", got, want)
		}
		if strings.Contains(got, "TLS not available") {
			t.Errorf("sanitizedError leaked raw server text: %q", got)
		}
	})

	t.Run("non_auth_errors_never_leak_passwords_tokens_or_server_text", func(t *testing.T) {
		plainNull := []byte("\x00" + user + "\x00" + password)
		plainAuthzid := []byte(user + "\x00" + user + "\x00" + password)

		tokens := []string{
			password,
			base64.StdEncoding.EncodeToString([]byte(password)),
			base64.RawStdEncoding.EncodeToString([]byte(password)),
			base64.URLEncoding.EncodeToString([]byte(password)),
			base64.RawURLEncoding.EncodeToString([]byte(password)),
			base64.StdEncoding.EncodeToString(plainNull),
			base64.RawStdEncoding.EncodeToString(plainNull),
			base64.URLEncoding.EncodeToString(plainNull),
			base64.RawURLEncoding.EncodeToString(plainNull),
			base64.StdEncoding.EncodeToString(plainAuthzid),
			base64.RawStdEncoding.EncodeToString(plainAuthzid),
			base64.URLEncoding.EncodeToString(plainAuthzid),
			base64.RawURLEncoding.EncodeToString(plainAuthzid),
		}

		for _, token := range tokens {
			tpErr := &textproto.Error{Code: 550, Msg: "relay echoed " + token + " via https://" + user + ":urlsecret@relay.example.com/submit"}
			got := sanitizedError(sendStep, tpErr).Error()
			want := "send kindle epub: send epub mail: smtp server error (550)"
			if got != want {
				t.Errorf("token %q: sanitizedError() = %q, want %q", token, got, want)
			}
			assertNoAuthSecrets(t, got, user, password)
			if strings.Contains(got, "relay echoed") || strings.Contains(got, "urlsecret") {
				t.Errorf("sanitizedError leaked server text: %q", got)
			}
		}

		invalidCodeErr := &textproto.Error{Code: 9999, Msg: "forged code"}
		if got := sanitizedError(sendStep, invalidCodeErr).Error(); got != "send kindle epub: send epub mail: smtp server error" {
			t.Errorf("invalid code sanitizedError() = %q", got)
		}
	})
}

func TestSendEPUBSingleWallClockDeadlineAcrossDialAndSend(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	stall := make(chan struct{})
	defer close(stall)
	enteredData := make(chan struct{})

	server := &smtpServer{
		tlsConfig:    serverTLS,
		implicitTLS:  true,
		greetingWait: 500 * time.Millisecond,
		enteredData:  enteredData,
		stallData:    stall,
		messages:     make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	delivery := kindleDelivery(t, server.address, domain.SMTPSecurityTLS, "", "")
	book := domain.EPUBBook{Title: "Lantern", Filename: "lantern.epub", Data: []byte("PK\x03\x04")}

	sender := NewSender(Config{Timeout: 800 * time.Millisecond, TLSConfig: clientTLS})
	started := time.Now()
	err := sender.SendEPUB(context.Background(), delivery, book)
	elapsed := time.Since(started)

	if err == nil {
		t.Fatal("SendEPUB() error = nil, want wall-clock timeout")
	}

	if !strings.Contains(err.Error(), "smtp timeout") {
		t.Errorf("SendEPUB() error = %q, want smtp timeout", err)
	}

	select {
	case <-enteredData:
	default:
		t.Fatal("SMTP DATA was not reached")
	}

	if elapsed >= 1150*time.Millisecond {
		t.Errorf("SendEPUB() took %v, expected single wall-clock deadline ~800ms", elapsed)
	}
}

func TestSendEPUBContextCancelClosesStalledPeerImmediately(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	stall := make(chan struct{})
	defer close(stall)

	enteredData := make(chan struct{})
	server := &smtpServer{
		tlsConfig:   serverTLS,
		implicitTLS: true,
		enteredData: enteredData,
		stallData:   stall,
		messages:    make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	delivery := kindleDelivery(t, server.address, domain.SMTPSecurityTLS, "", "")
	book := domain.EPUBBook{Title: "Lantern", Filename: "lantern.epub", Data: []byte("PK\x03\x04")}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-enteredData
		cancel()
	}()

	sender := NewSender(Config{Timeout: 10 * time.Second, TLSConfig: clientTLS})
	started := time.Now()
	err := sender.SendEPUB(ctx, delivery, book)
	elapsed := time.Since(started)

	if err == nil {
		t.Fatal("SendEPUB() error = nil, want canceled error")
	}

	if !strings.Contains(err.Error(), "smtp canceled") {
		t.Errorf("SendEPUB() error = %q, want smtp canceled", err)
	}

	if elapsed >= 2*time.Second {
		t.Errorf("SendEPUB() waited %v after context cancel, expected immediate close", elapsed)
	}
}

func TestSendEPUBRejectsOversizedServerReply(t *testing.T) {
	serverTLS, clientTLS := newTestTLSConfigs(t)
	server := &smtpServer{
		tlsConfig:      serverTLS,
		implicitTLS:    true,
		oversizedGreet: true,
		messages:       make(chan capturedMail, 1),
	}
	startSMTPServer(t, server)

	delivery := kindleDelivery(t, server.address, domain.SMTPSecurityTLS, "", "")
	book := domain.EPUBBook{Title: "Lantern", Filename: "lantern.epub", Data: []byte("PK\x03\x04")}

	sender := NewSender(Config{Timeout: 5 * time.Second, TLSConfig: clientTLS})
	sender.maxReadBytes = 2048

	err := sender.SendEPUB(context.Background(), delivery, book)
	if err == nil {
		t.Fatal("SendEPUB() error = nil, want reply size limit error")
	}

	if !strings.Contains(err.Error(), "smtp reply exceeded limit") {
		t.Errorf("SendEPUB() error = %q, want smtp reply exceeded limit", err)
	}
}
