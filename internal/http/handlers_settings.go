package httpserver

import (
	"context"
	"net/http"
	"time"

	"reader/internal/domain"
)

type settingsJSON struct {
	Retention                 int                      `json:"retention"`
	Provider                  domain.ExtractorProvider `json:"provider"`
	JinaKeyConfigured         bool                     `json:"jinaKeyConfigured"`
	BrowserEndpointConfigured bool                     `json:"browserEndpointConfigured"`
	SMTP                      *smtpSettingsJSON        `json:"smtp,omitempty"`
	Kindle                    *kindleSettingsJSON      `json:"kindle,omitempty"`
}

type smtpSettingsJSON struct {
	SenderEmail        string              `json:"senderEmail"`
	Host               string              `json:"host"`
	Port               int                 `json:"port"`
	Security           domain.SMTPSecurity `json:"security"`
	User               *string             `json:"user,omitempty"`
	PasswordConfigured bool                `json:"passwordConfigured"`
}

type kindleScheduleJSON struct {
	Hour     int    `json:"hour"`
	Minute   int    `json:"minute"`
	Timezone string `json:"timezone"`
}

type kindleSettingsJSON struct {
	KindleEmail string              `json:"kindleEmail"`
	Schedule    *kindleScheduleJSON `json:"schedule,omitempty"`
	NextSendAt  *string             `json:"nextSendAt,omitempty"`
}

type retentionRequest struct {
	Retention int `json:"retention"`
}

type providerRequest struct {
	Provider domain.ExtractorProvider `json:"provider"`
}

type jinaKeyRequest struct {
	Key string `json:"key"`
}

type browserEndpointRequest struct {
	Endpoint string `json:"endpoint"`
}

type smtpSettingsRequest struct {
	SenderEmail string              `json:"senderEmail"`
	Host        string              `json:"host"`
	Port        int                 `json:"port"`
	Security    domain.SMTPSecurity `json:"security"`
	User        *string             `json:"user"`
	Password    *string             `json:"password"`
}

// Hour and Minute are pointers so a missing or null value is rejected instead
// of silently becoming 00:00.
type kindleScheduleRequest struct {
	Hour     *int   `json:"hour"`
	Minute   *int   `json:"minute"`
	Timezone string `json:"timezone"`
}

type kindleSettingsRequest struct {
	KindleEmail string                 `json:"kindleEmail"`
	Schedule    *kindleScheduleRequest `json:"schedule"`
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

	if settings.SMTP != nil {
		response.SMTP = &smtpSettingsJSON{
			SenderEmail:        settings.SMTP.SenderEmail,
			Host:               settings.SMTP.Host,
			Port:               settings.SMTP.Port,
			Security:           settings.SMTP.Security,
			User:               settings.SMTP.User,
			PasswordConfigured: secretConfigured(settings.SMTP.Password),
		}
	}

	if settings.Kindle != nil {
		kindle, err := s.toKindleSettingsJSON(r.Context(), *settings.Kindle)
		if err != nil {
			writeError(w, err)

			return
		}

		response.Kindle = &kindle
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *server) toKindleSettingsJSON(ctx context.Context, kindle domain.KindleSettings) (kindleSettingsJSON, error) {
	response := kindleSettingsJSON{KindleEmail: kindle.KindleEmail}
	if kindle.Schedule == nil {
		return response, nil
	}

	nextSendAt, err := s.kindleNextSendAt(ctx, kindle, *kindle.Schedule)
	if err != nil {
		return kindleSettingsJSON{}, err
	}

	response.Schedule = &kindleScheduleJSON{Hour: kindle.Schedule.Hour, Minute: kindle.Schedule.Minute, Timezone: kindle.Schedule.Timezone}
	response.NextSendAt = formatTimestampPtr(&nextSendAt)

	return response, nil
}

func (s *server) kindleNextSendAt(ctx context.Context, kindle domain.KindleSettings, schedule domain.KindleSchedule) (time.Time, error) {
	loc, err := domain.LoadKindleLocation(schedule.Timezone)
	if err != nil {
		return time.Time{}, err
	}

	lastScheduledStartedAt, err := s.cfg.KindleSends.LastScheduledStartedAt(ctx)
	if err != nil {
		return time.Time{}, err
	}

	anchor := scheduleAnchor(kindle.ScheduleUpdatedAt, lastScheduledStartedAt)

	return domain.KindleNextSendAt(schedule, loc, s.cfg.Now().UTC(), anchor), nil
}

// scheduleAnchor is the later of the schedule's last change and the start of the
// newest scheduled send; occurrences at or before it are no longer due.
func scheduleAnchor(scheduleUpdatedAt, lastScheduledStartedAt *time.Time) time.Time {
	var anchor time.Time

	for _, candidate := range []*time.Time{scheduleUpdatedAt, lastScheduledStartedAt} {
		if candidate != nil && candidate.After(anchor) {
			anchor = *candidate
		}
	}

	return anchor
}

func secretConfigured(value *string) bool {
	return value != nil && *value != ""
}

func (s *server) handleRetentionUpdate(w http.ResponseWriter, r *http.Request) {
	decodeAndSave(w, r, func(ctx context.Context, req retentionRequest) error {
		if err := domain.ValidateRetention(req.Retention); err != nil {
			return err
		}

		return s.cfg.Settings.UpdateRetention(ctx, req.Retention)
	})
}

func (s *server) handleProviderUpdate(w http.ResponseWriter, r *http.Request) {
	decodeAndSave(w, r, func(ctx context.Context, req providerRequest) error {
		if err := domain.ValidateProvider(req.Provider); err != nil {
			return err
		}

		return s.cfg.Settings.UpdateProvider(ctx, req.Provider)
	})
}

func (s *server) handleJinaKeySave(w http.ResponseWriter, r *http.Request) {
	decodeAndSave(w, r, func(ctx context.Context, req jinaKeyRequest) error {
		validated, err := domain.ValidateJinaKey(req.Key)
		if err != nil {
			return err
		}

		return s.cfg.Settings.UpdateJinaKey(ctx, validated)
	})
}

func (s *server) handleJinaKeyDelete(w http.ResponseWriter, r *http.Request) {
	runSettingUpdate(w, r, s.cfg.Settings.DeleteJinaKey)
}

func (s *server) handleBrowserEndpointSave(w http.ResponseWriter, r *http.Request) {
	decodeAndSave(w, r, func(ctx context.Context, req browserEndpointRequest) error {
		validated, err := domain.ValidateBrowserEndpoint(req.Endpoint)
		if err != nil {
			return err
		}

		return s.cfg.Settings.UpdateBrowserEndpoint(ctx, validated)
	})
}

func (s *server) handleBrowserEndpointDelete(w http.ResponseWriter, r *http.Request) {
	runSettingUpdate(w, r, s.cfg.Settings.DeleteBrowserEndpoint)
}

func (s *server) handleSMTPSave(w http.ResponseWriter, r *http.Request) {
	decodeAndSave(w, r, func(ctx context.Context, req smtpSettingsRequest) error {
		validated, err := domain.ValidateSMTPSettings(domain.SMTPSettings{
			SenderEmail: req.SenderEmail,
			Host:        req.Host,
			Port:        req.Port,
			Security:    req.Security,
			User:        req.User,
			Password:    req.Password,
		})
		if err != nil {
			return err
		}

		return s.cfg.Settings.UpdateSMTP(ctx, validated)
	})
}

func (s *server) handleSMTPDelete(w http.ResponseWriter, r *http.Request) {
	runSettingUpdate(w, r, s.cfg.Settings.DeleteSMTP)
}

func (s *server) handleSMTPPasswordDelete(w http.ResponseWriter, r *http.Request) {
	runSettingUpdate(w, r, s.cfg.Settings.DeleteSMTPPassword)
}

func (s *server) handleKindleSettingsUpdate(w http.ResponseWriter, r *http.Request) {
	decodeAndSave(w, r, func(ctx context.Context, req kindleSettingsRequest) error {
		kindle, err := toKindleSettings(req)
		if err != nil {
			return err
		}

		validated, err := domain.ValidateKindleSettings(kindle)
		if err != nil {
			return err
		}

		return s.cfg.Settings.UpdateKindle(ctx, validated, s.cfg.Now())
	})
}

func toKindleSettings(req kindleSettingsRequest) (domain.KindleSettings, error) {
	kindle := domain.KindleSettings{KindleEmail: req.KindleEmail}
	if req.Schedule == nil {
		return kindle, nil
	}

	if req.Schedule.Hour == nil || req.Schedule.Minute == nil {
		return domain.KindleSettings{}, domain.NewError(domain.ErrInvalidKindleSetting, nil)
	}

	kindle.Schedule = &domain.KindleSchedule{Hour: *req.Schedule.Hour, Minute: *req.Schedule.Minute, Timezone: req.Schedule.Timezone}

	return kindle, nil
}

func decodeAndSave[Req any](w http.ResponseWriter, r *http.Request, save func(context.Context, Req) error) {
	var req Req
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	runSettingUpdate(w, r, func(ctx context.Context) error {
		return save(ctx, req)
	})
}

func runSettingUpdate(w http.ResponseWriter, r *http.Request, update func(context.Context) error) {
	if err := update(r.Context()); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}
