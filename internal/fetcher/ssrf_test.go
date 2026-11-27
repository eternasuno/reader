package fetcher

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"reader/internal/domain"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
)

const dnsTypeA = 1

func TestIsBlockedIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"224.0.0.1",
		"198.18.0.1",
		"255.255.255.255",
		"::1",
		"fe80::1",
		"fe80::1%eth0",
		"::",
		"192.0.0.1",
		"240.0.0.1",
		"fc00::1",
		"ff02::1",
		"64:ff9b::127.0.0.1",
		"64:ff9b::192.0.2.1",
		"64:ff9b:1::1",
		"64:ff9b:1:ffff::1",
		"::ffff:127.0.0.1",
		"::ffff:10.0.0.1",
	}

	for _, raw := range blocked {
		t.Run(raw, func(t *testing.T) {
			addr, err := netip.ParseAddr(raw)
			if err != nil {
				t.Fatalf("parse %q: %v", raw, err)
			}

			if !IsBlockedIP(addr) {
				t.Fatalf("expected %s to be blocked", raw)
			}
		})
	}

	allowed := []string{
		"93.184.216.34",
		"2606:2800:220:1:248:1893:25c8:1946",
		"2606:2800:220:1:248:1893:25c8:1946%eth0",
		"64:ff9c::1",
		"8.8.8.8",
		"1.1.1.1",
	}

	for _, raw := range allowed {
		t.Run(raw, func(t *testing.T) {
			addr, err := netip.ParseAddr(raw)
			if err != nil {
				t.Fatalf("parse %q: %v", raw, err)
			}

			if IsBlockedIP(addr) {
				t.Fatalf("expected %s to be allowed", raw)
			}
		})
	}

	if !IsBlockedIP(netip.Addr{}) {
		t.Fatal("expected invalid address to be blocked")
	}
}

func TestCheckDialAddress(t *testing.T) {
	if err := checkDialAddress("127.0.0.1:80"); !errors.Is(err, domain.ErrBlockedAddress) {
		t.Fatalf("expected loopback dial to be blocked, got %v", err)
	}

	if err := checkDialAddress("[fe80::1]:443"); !errors.Is(err, domain.ErrBlockedAddress) {
		t.Fatalf("expected link-local dial to be blocked, got %v", err)
	}

	if err := checkDialAddress("169.254.169.254:80"); !errors.Is(err, domain.ErrBlockedAddress) {
		t.Fatalf("expected metadata address dial to be blocked, got %v", err)
	}

	if err := checkDialAddress("93.184.216.34:443"); err != nil {
		t.Fatalf("expected public dial to be allowed, got %v", err)
	}

	if err := checkDialAddress("93.184.216.34"); !errors.Is(err, errInvalidDialAddr) {
		t.Fatalf("expected portless address to be rejected, got %v", err)
	}
}

func TestRedirectPolicy(t *testing.T) {
	newRequest := func(t *testing.T, raw string) *http.Request {
		t.Helper()

		req, err := http.NewRequest(http.MethodGet, raw, nil)
		if err != nil {
			t.Fatalf("new request %q: %v", raw, err)
		}

		return req
	}

	t.Run("too many redirects", func(t *testing.T) {
		via := make([]*http.Request, maxRedirects)
		for i := range via {
			via[i] = newRequest(t, "https://example.com/step")
		}

		if err := redirectPolicy(newRequest(t, "https://example.com/next"), via); !errors.Is(err, errTooManyRedirects) {
			t.Fatalf("expected redirect limit error, got %v", err)
		}
	})

	t.Run("rejects non http scheme", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/step")}

		if err := redirectPolicy(newRequest(t, "file:///etc/passwd"), via); !errors.Is(err, errBadRedirectURL) {
			t.Fatalf("expected scheme rejection, got %v", err)
		}
	})

	t.Run("rejects empty host", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/step")}
		req := &http.Request{URL: &url.URL{Scheme: "http"}}

		if err := redirectPolicy(req, via); !errors.Is(err, errBadRedirectURL) {
			t.Fatalf("expected host rejection, got %v", err)
		}
	})

	t.Run("strips authorization across hosts and keeps it stripped on subsequent hops", func(t *testing.T) {
		initial := newRequest(t, "https://a.example/step")
		initial.Header.Set("Authorization", "Bearer secret")
		hop1 := newRequest(t, "https://b.example/hop1")
		hop1.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(hop1, []*http.Request{initial}); err != nil {
			t.Fatalf("unexpected error on hop 1: %v", err)
		}

		if hop1.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to be stripped on hop 1")
		}

		hop2 := newRequest(t, "https://b.example/hop2")
		hop2.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(hop2, []*http.Request{initial, hop1}); err != nil {
			t.Fatalf("unexpected error on hop 2: %v", err)
		}

		if hop2.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to stay stripped on hop 2")
		}
	})

	t.Run("keeps authorization on same host", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://a.example/step")}
		req := newRequest(t, "https://a.example/next")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "Bearer secret" {
			t.Fatal("expected authorization header to be kept")
		}
	})

	t.Run("strips authorization on https to http downgrade", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/a")}
		req := newRequest(t, "http://example.com/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to be stripped")
		}
	})

	t.Run("strips authorization on port change", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com:8443/a")}
		req := newRequest(t, "https://example.com/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to be stripped")
		}
	})

	t.Run("keeps authorization on same scheme and port", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/a")}
		req := newRequest(t, "https://example.com/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "Bearer secret" {
			t.Fatal("expected authorization header to be kept")
		}
	})

	t.Run("keeps authorization across default port", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/a")}
		req := newRequest(t, "https://example.com:443/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "Bearer secret" {
			t.Fatal("expected authorization header to be kept")
		}
	})
}

func TestPrivateNetworkBlocked(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html><body>should not be reached</body></html>"))
	}))
	defer server.Close()

	client := New(Config{})
	ctx := context.Background()

	_, _, err := client.FetchFeed(ctx, mustNormalizedURL(t, server.URL+"/feed.xml"))
	requireDomainCode(t, err, domain.ErrFetchFeedError)

	_, _, err = client.FetchDirect(ctx, mustNormalizedURL(t, server.URL+"/page"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	_, _, _, err = client.FetchImage(ctx, server.URL+"/image.png")
	if err == nil {
		t.Fatal("expected image fetch against loopback to fail")
	}

	if !strings.Contains(err.Error(), "blocked non-public address") {
		t.Fatalf("expected blocked address error, got %v", err)
	}
}

func TestDialChecksResolvedAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("unexpected"))
	}))
	defer server.Close()

	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}

	client := New(Config{})
	_, _, err = client.FetchFeed(context.Background(), mustNormalizedURL(t, "http://localhost:"+port+"/feed"))
	if !errors.Is(err, domain.ErrBlockedAddress) {
		t.Fatalf("expected resolved loopback to be blocked, got %v", err)
	}
}

func TestRedirectToBlockedAddress(t *testing.T) {
	var blockedHits atomic.Int32

	blockedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blockedHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer blockedServer.Close()

	allowedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, blockedServer.URL+"/secret", http.StatusFound)
	}))
	defer allowedServer.Close()

	allowedAddress := allowedServer.Listener.Addr().String()

	client := New(Config{})
	client.httpClient = newHTTPClientWithDialCheck(func(address string) error {
		if address == allowedAddress {
			return nil
		}

		return checkDialAddress(address)
	})

	_, _, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, allowedServer.URL+"/feed.xml"))
	requireDomainCode(t, err, domain.ErrFetchFeedError)

	if blockedHits.Load() != 0 {
		t.Fatal("expected redirect target to be blocked before connecting")
	}

	if !strings.Contains(err.Error(), "blocked non-public address") {
		t.Fatalf("expected blocked address error, got %v", err)
	}
}

func TestFetchDirectBlockedAddressMatchesSentinel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("unexpected"))
	}))
	defer server.Close()

	client := New(Config{})
	_, _, err := client.FetchDirect(context.Background(), mustNormalizedURL(t, server.URL+"/page"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !errors.Is(err, domain.ErrBlockedAddress) {
		t.Fatalf("expected errors.Is(err, domain.ErrBlockedAddress), got %v", err)
	}
}

func TestFetchDirectBlockedCredentialedRedirectMatchesSentinel(t *testing.T) {
	var blockedHits atomic.Int32

	blockedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blockedHits.Add(1)
	}))
	defer blockedServer.Close()

	blockedURL, err := url.Parse(blockedServer.URL)
	if err != nil {
		t.Fatal(err)
	}

	allowedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://rediruser:redirsecret@"+blockedURL.Host+"/secret", http.StatusFound)
	}))
	defer allowedServer.Close()

	allowedAddress := allowedServer.Listener.Addr().String()

	client := New(Config{})
	client.httpClient = newHTTPClientWithDialCheck(func(address string) error {
		if address == allowedAddress {
			return nil
		}

		return checkDialAddress(address)
	})

	_, _, err = client.FetchDirect(context.Background(), mustNormalizedURL(t, allowedServer.URL+"/page"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !errors.Is(err, domain.ErrBlockedAddress) {
		t.Fatalf("expected errors.Is(err, domain.ErrBlockedAddress), got %v", err)
	}

	if strings.Contains(err.Error(), "redirsecret") || blockedHits.Load() != 0 {
		t.Fatalf("redirect leaked credentials or reached blocked server: %v", err)
	}
}

type stubDNS struct {
	conn    net.PacketConn
	answers []netip.Addr
}

func startStubDNS(t *testing.T, answers []string) *stubDNS {
	t.Helper()

	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	stub := &stubDNS{conn: conn}

	for _, raw := range answers {
		stub.answers = append(stub.answers, netip.MustParseAddr(raw))
	}

	served := make(chan struct{})

	go stub.serve(served)

	t.Cleanup(func() {
		_ = conn.Close()
		<-served
	})

	return stub
}

func (s *stubDNS) resolver() *net.Resolver {
	return &net.Resolver{PreferGo: true, Dial: s.dial}
}

func (s *stubDNS) dial(ctx context.Context, _ string, _ string) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, "udp", s.conn.LocalAddr().String())
}

func (s *stubDNS) serve(done chan<- struct{}) {
	defer close(done)

	buf := make([]byte, 512)

	for {
		n, peer, err := s.conn.ReadFrom(buf)
		if err != nil {
			return
		}

		_, _ = s.conn.WriteTo(s.response(buf[:n]), peer)
	}
}

func (s *stubDNS) response(query []byte) []byte {
	questionEnd := 12
	for query[questionEnd] != 0 {
		questionEnd += int(query[questionEnd]) + 1
	}

	questionEnd += 5

	records := s.answers
	if binary.BigEndian.Uint16(query[questionEnd-4:]) != dnsTypeA {
		records = nil
	}

	reply := append([]byte{query[0], query[1], 0x81, 0x80, 0, 1, 0, byte(len(records)), 0, 0, 0, 0}, query[12:questionEnd]...)
	for _, addr := range records {
		reply = append(reply, 0xc0, 0x0c, 0, dnsTypeA, 0, 1, 0, 0, 0, 0, 0, 4)
		reply = append(reply, addr.AsSlice()...)
	}

	return reply
}

func blockHosts(hosts []string) func(address string) error {
	return func(address string) error {
		addrPort, err := netip.ParseAddrPort(address)
		if err == nil && slices.Contains(hosts, addrPort.Addr().String()) {
			return domain.ErrBlockedAddress
		}

		return nil
	}
}

func loopbackPort(t *testing.T, listening bool) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	if listening {
		t.Cleanup(func() { _ = listener.Close() })
	} else {
		_ = listener.Close()
	}

	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}

	return port
}

func TestCheckedDialerKeepsBlockedSentinelAcrossResolvedAddresses(t *testing.T) {
	both := []string{"127.0.0.1", "127.0.0.2"}
	blockedFirst := []string{"127.0.0.2", "127.0.0.1"}

	tests := []struct {
		name        string
		answers     []string
		blocked     []string
		listening   bool
		wantBlocked bool
		wantConn    bool
	}{
		{name: "refused before blocked", answers: both, blocked: []string{"127.0.0.2"}, wantBlocked: true},
		{name: "blocked before refused", answers: blockedFirst, blocked: []string{"127.0.0.2"}, wantBlocked: true},
		{name: "all blocked", answers: both, blocked: both, wantBlocked: true},
		{name: "nothing blocked", answers: both},
		{name: "blocked before connectable", answers: blockedFirst, blocked: []string{"127.0.0.2"}, listening: true, wantConn: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dialer := newCheckedDialer(blockHosts(tt.blocked))
			dialer.dialer.Resolver = startStubDNS(t, tt.answers).resolver()
			address := net.JoinHostPort("multi.test", loopbackPort(t, tt.listening))

			conn, err := dialer.DialContext(context.Background(), "tcp", address)
			if conn != nil {
				_ = conn.Close()
			}

			if (conn != nil) != tt.wantConn || (err == nil) != tt.wantConn {
				t.Fatalf("dial result conn=%v err=%v, want connection=%v", conn, err, tt.wantConn)
			}

			if errors.Is(err, domain.ErrBlockedAddress) != tt.wantBlocked {
				t.Fatalf("errors.Is(err, ErrBlockedAddress) != %v for %v", tt.wantBlocked, err)
			}

			if tt.wantBlocked && strings.Count(err.Error(), domain.ErrBlockedAddress.Error()) != 1 {
				t.Fatalf("expected the blocked sentinel text once, got %v", err)
			}
		})
	}
}
