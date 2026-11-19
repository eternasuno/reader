package httpserver

import (
	"net/http"
	"strings"

	"reader/internal/domain"
)

type settingsJSON struct {
	Retention                 int                      `json:"retention"`
	Provider                  domain.ExtractorProvider `json:"provider"`
	JinaKeyConfigured         bool                     `json:"jinaKeyConfigured"`
	BrowserEndpointConfigured bool                     `json:"browserEndpointConfigured"`
	Kindle                    *kindleSettingsJSON      `json:"kindle,omitempty"`
}

type kindleSettingsJSON struct {
	KindleEmail            string              `json:"kindleEmail"`
	SenderEmail            string              `json:"senderEmail"`
	SMTPHost               string              `json:"smtpHost"`
	SMTPPort               int                 `json:"smtpPort"`
	SMTPSecurity           domain.SMTPSecurity `json:"smtpSecurity"`
	SMTPUser               *string             `json:"smtpUser,omitempty"`
	SMTPPasswordConfigured bool                `json:"smtpPasswordConfigured"`
	SendTime               *string             `json:"sendTime,omitempty"`
	NextSendAt             *string             `json:"nextSendAt,omitempty"`
}

type retentionRequest struct {
	Retention int `json:"retention"`
}

type jinaKeyRequest struct {
	Key *string `json:"key"`
}

type browserEndpointRequest struct {
	Endpoint *string `json:"endpoint"`
}

type kindleSettingsRequest struct {
	KindleEmail  string              `json:"kindleEmail"`
	SenderEmail  string              `json:"senderEmail"`
	SMTPHost     string              `json:"smtpHost"`
	SMTPPort     int                 `json:"smtpPort"`
	SMTPSecurity domain.SMTPSecurity `json:"smtpSecurity"`
	SMTPUser     *string             `json:"smtpUser"`
	SMTPPassword *string             `json:"smtpPassword"`
	SendTime     *string             `json:"sendTime"`
}

func (s *server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	settings, err := s.cfg.Settings.Get(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	response := settingsJSON{
		Retention:                 settings.Retention,
		Provider:                  settings.Provider,
		JinaKeyConfigured:         secretConfigured(settings.JinaKey),
		BrowserEndpointConfigured: secretConfigured(settings.BrowserEndpoint),
	}

	if settings.Kindle != nil {
		response.Kindle = &kindleSettingsJSON{
			KindleEmail:            settings.Kindle.KindleEmail,
			SenderEmail:            settings.Kindle.SenderEmail,
			SMTPHost:               settings.Kindle.SMTPHost,
			SMTPPort:               settings.Kindle.SMTPPort,
			SMTPSecurity:           settings.Kindle.SMTPSecurity,
			SMTPUser:               settings.Kindle.SMTPUser,
			SMTPPasswordConfigured: secretConfigured(settings.Kindle.SMTPPassword),
			SendTime:               settings.Kindle.SendTime,
			NextSendAt:             formatTimestampPtr(settings.Kindle.NextSendAt),
		}
	}

	writeJSON(w, http.StatusOK, response)
}

func secretConfigured(value *string) bool {
	return value != nil && *value != ""
}

func (s *server) handleRetentionUpdate(w http.ResponseWriter, r *http.Request) {
	var req retentionRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if err := domain.ValidateRetention(req.Retention); err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.Settings.UpdateRetention(r.Context(), req.Retention); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFetcherDirect(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.Settings.UpdateFetcherDirect(r.Context()); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFetcherJina(w http.ResponseWriter, r *http.Request) {
	var req jinaKeyRequest
	if err := decodeOptionalJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.Settings.UpdateFetcherJina(r.Context(), trimOptional(req.Key)); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFetcherBrowser(w http.ResponseWriter, r *http.Request) {
	var req browserEndpointRequest
	if err := decodeOptionalJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	var endpoint *string
	if req.Endpoint != nil && strings.TrimSpace(*req.Endpoint) != "" {
		validated, err := domain.ValidateBrowserEndpoint(*req.Endpoint)
		if err != nil {
			writeError(w, err)

			return
		}

		endpoint = &validated
	}

	if err := s.cfg.Settings.UpdateFetcherBrowser(r.Context(), endpoint); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleJinaKeyDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.Settings.DeleteJinaKey(r.Context()); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleKindleSettingsUpdate(w http.ResponseWriter, r *http.Request) {
	var req kindleSettingsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	validated, err := domain.ValidateKindleSettings(domain.KindleSettings{
		KindleEmail:  req.KindleEmail,
		SenderEmail:  req.SenderEmail,
		SMTPHost:     req.SMTPHost,
		SMTPPort:     req.SMTPPort,
		SMTPSecurity: req.SMTPSecurity,
		SMTPUser:     trimOptional(req.SMTPUser),
		SMTPPassword: req.SMTPPassword,
		SendTime:     req.SendTime,
	}, s.cfg.Now(), s.cfg.Location)
	if err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.Settings.UpdateKindle(r.Context(), validated); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleKindlePasswordDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.Settings.DeleteKindlePassword(r.Context()); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}
