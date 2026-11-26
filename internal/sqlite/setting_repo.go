package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"reader/internal/domain"
)

// settingsQuery reads the singleton setting row with its kindle_schedule row
// (absent while scheduled sending is off) in one snapshot.
const settingsQuery = `SELECT retention, provider, jina_key, browser_endpoint, kindle_email, sender_email, smtp_host, smtp_port, smtp_security, smtp_user, smtp_password, timezone, send_hour, send_minute, kindle_schedule.id, kindle_schedule.next_send_at
	FROM setting LEFT JOIN kindle_schedule ON kindle_schedule.setting_id = setting.id
	WHERE setting.id = 1`

type SettingRepo struct {
	read  *sql.DB
	write *sql.DB
}

type settingsRow struct {
	retention       int64
	provider        string
	jinaKey         sql.NullString
	browserEndpoint sql.NullString
	kindleEmail     sql.NullString
	senderEmail     sql.NullString
	smtpHost        sql.NullString
	smtpPort        sql.NullInt64
	smtpSecurity    sql.NullString
	smtpUser        sql.NullString
	smtpPassword    sql.NullString
	timezone        sql.NullString
	sendHour        sql.NullInt64
	sendMinute      sql.NullInt64
	scheduleID      sql.NullString
	nextSendAt      sql.NullInt64
}

func (r *SettingRepo) Get(ctx context.Context) (domain.Settings, error) {
	row, err := loadSettingsRow(ctx, r.read)
	if err != nil {
		return domain.Settings{}, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return settingsFromRow(row)
}

func settingsFromRow(row settingsRow) (domain.Settings, error) {
	kindle := buildKindleSettings(row)
	if err := validateStoredSchedule(kindle); err != nil {
		return domain.Settings{}, err
	}

	return domain.Settings{
		Retention:       int(row.retention),
		Provider:        domain.ExtractorProvider(row.provider),
		JinaKey:         optionalText(row.jinaKey),
		BrowserEndpoint: optionalText(row.browserEndpoint),
		SMTP:            buildSMTPSettings(row),
		Kindle:          kindle,
	}, nil
}

// Schedules are stored only after domain validation, so one that fails it (or
// that validation would rewrite) is corrupt data: an internal persistence
// failure, never a bad request.
func validateStoredSchedule(kindle *domain.KindleSettings) error {
	if kindle == nil || kindle.Schedule == nil {
		return nil
	}

	validated, err := domain.ValidateKindleSchedule(*kindle.Schedule)
	if err == nil && validated == *kindle.Schedule {
		return nil
	}

	return domain.NewError(domain.ErrSettingRepositoryError, fmt.Errorf("stored kindle schedule %+v is invalid", *kindle.Schedule))
}

func loadSettingsRow(ctx context.Context, querier rowQuerier) (settingsRow, error) {
	var s settingsRow
	err := querier.QueryRowContext(ctx, settingsQuery).Scan(
		&s.retention,
		&s.provider,
		&s.jinaKey,
		&s.browserEndpoint,
		&s.kindleEmail,
		&s.senderEmail,
		&s.smtpHost,
		&s.smtpPort,
		&s.smtpSecurity,
		&s.smtpUser,
		&s.smtpPassword,
		&s.timezone,
		&s.sendHour,
		&s.sendMinute,
		&s.scheduleID,
		&s.nextSendAt,
	)

	return s, err
}

func buildSMTPSettings(s settingsRow) *domain.SMTPSettings {
	if !hasSMTPSettings(s.senderEmail, s.smtpHost, s.smtpPort, s.smtpSecurity) {
		return nil
	}

	return &domain.SMTPSettings{
		SenderEmail: s.senderEmail.String,
		Host:        s.smtpHost.String,
		Port:        int(s.smtpPort.Int64),
		Security:    domain.SMTPSecurity(s.smtpSecurity.String),
		User:        optionalText(s.smtpUser),
		Password:    optionalText(s.smtpPassword),
	}
}

func buildKindleSettings(s settingsRow) *domain.KindleSettings {
	if !s.kindleEmail.Valid {
		return nil
	}

	return &domain.KindleSettings{
		KindleEmail: s.kindleEmail.String,
		Schedule:    buildKindleSchedule(s),
		NextSendAt:  optionalMillis(s.nextSendAt),
	}
}

func buildKindleSchedule(s settingsRow) *domain.KindleSchedule {
	if !s.sendHour.Valid || !s.sendMinute.Valid || !s.timezone.Valid {
		return nil
	}

	return &domain.KindleSchedule{Hour: int(s.sendHour.Int64), Minute: int(s.sendMinute.Int64), Timezone: s.timezone.String}
}

func (r *SettingRepo) UpdateRetention(ctx context.Context, retention int) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET retention = ? WHERE id = 1`, retention); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) UpdateProvider(ctx context.Context, provider domain.ExtractorProvider) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		if provider == domain.ProviderBrowser {
			var stored sql.NullString
			if err := tx.QueryRowContext(ctx, `SELECT browser_endpoint FROM setting WHERE id = 1`).Scan(&stored); err != nil {
				return err
			}

			if !stored.Valid {
				return domain.NewError(domain.ErrBrowserEndpointRequired, nil)
			}
		}

		_, err := tx.ExecContext(ctx, `UPDATE setting SET provider = ? WHERE id = 1`, string(provider))

		return err
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func (r *SettingRepo) UpdateJinaKey(ctx context.Context, key string) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET jina_key = ? WHERE id = 1`, key); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) DeleteJinaKey(ctx context.Context) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET jina_key = NULL WHERE id = 1`); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) UpdateBrowserEndpoint(ctx context.Context, endpoint string) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET browser_endpoint = ? WHERE id = 1`, endpoint); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) DeleteBrowserEndpoint(ctx context.Context) error {
	_, err := r.write.ExecContext(
		ctx,
		`UPDATE setting SET browser_endpoint = NULL, provider = CASE WHEN provider = 'browser' THEN 'direct' ELSE provider END WHERE id = 1`,
	)
	if err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) UpdateSMTP(ctx context.Context, smtp domain.SMTPSettings) error {
	query := `UPDATE setting SET sender_email = ?, smtp_host = ?, smtp_port = ?, smtp_security = ?, smtp_user = ?`
	args := []any{
		smtp.SenderEmail,
		smtp.Host,
		smtp.Port,
		string(smtp.Security),
		optionalString(smtp.User),
	}

	if smtp.Password != nil && strings.TrimSpace(*smtp.Password) != "" {
		query += `, smtp_password = ?`
		args = append(args, *smtp.Password)
	}

	query += ` WHERE id = 1`

	if _, err := r.write.ExecContext(ctx, query, args...); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) DeleteSMTPPassword(ctx context.Context) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET smtp_password = NULL WHERE id = 1`); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) DeleteSMTP(ctx context.Context) error {
	_, err := r.write.ExecContext(
		ctx,
		`UPDATE setting SET sender_email = NULL, smtp_host = NULL, smtp_port = NULL, smtp_security = NULL, smtp_user = NULL, smtp_password = NULL WHERE id = 1`,
	)
	if err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

// UpdateKindle owns the kindle_schedule row: it is deleted while the schedule
// is off, and created or recomputed from now when the schedule is newly enabled
// or its hour, minute, or timezone changed. An unchanged schedule keeps its
// stored next send time; kindle.NextSendAt is ignored.
func (r *SettingRepo) UpdateKindle(ctx context.Context, kindle domain.KindleSettings, now time.Time) error {
	// An out-of-range schedule has no occurrence, and computing its next send
	// time would never return while holding the only writer.
	if kindle.Schedule != nil {
		if _, err := domain.ValidateKindleSchedule(*kindle.Schedule); err != nil {
			return err
		}
	}

	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		current, err := loadSettingsRow(ctx, tx)
		if err != nil {
			return err
		}

		if !hasSMTPSettings(current.senderEmail, current.smtpHost, current.smtpPort, current.smtpSecurity) {
			return domain.NewError(domain.ErrSMTPNotConfigured, nil)
		}

		hour, minute, timezone := scheduleColumns(kindle.Schedule)
		_, err = tx.ExecContext(
			ctx,
			`UPDATE setting SET kindle_email = ?, send_hour = ?, send_minute = ?, timezone = ? WHERE id = 1`,
			kindle.KindleEmail,
			hour,
			minute,
			timezone,
		)
		if err != nil {
			return err
		}

		return saveKindleScheduleInTx(ctx, tx, current, kindle.Schedule, now)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func scheduleColumns(schedule *domain.KindleSchedule) (hour any, minute any, timezone any) {
	if schedule == nil {
		return nil, nil, nil
	}

	return schedule.Hour, schedule.Minute, schedule.Timezone
}

func saveKindleScheduleInTx(ctx context.Context, tx *sql.Tx, current settingsRow, schedule *domain.KindleSchedule, now time.Time) error {
	if schedule == nil {
		_, err := tx.ExecContext(ctx, `DELETE FROM kindle_schedule WHERE setting_id = 1`)

		return err
	}

	previous := buildKindleSchedule(current)
	if current.scheduleID.Valid && previous != nil && *previous == *schedule {
		return nil
	}

	loc, err := domain.LoadKindleLocation(schedule.Timezone)
	if err != nil {
		return err
	}

	nextSendAt := timeToMillis(domain.NextKindleOccurrence(*schedule, loc, now))
	if current.scheduleID.Valid {
		_, err = tx.ExecContext(ctx, `UPDATE kindle_schedule SET next_send_at = ? WHERE id = ?`, nextSendAt, current.scheduleID.String)

		return err
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO kindle_schedule (id, setting_id, next_send_at) VALUES (?, 1, ?)`, domain.NewID(), nextSendAt)

	return err
}

func hasSMTPSettings(senderEmail sql.NullString, smtpHost sql.NullString, smtpPort sql.NullInt64, smtpSecurity sql.NullString) bool {
	return senderEmail.Valid && smtpHost.Valid && smtpPort.Valid && smtpSecurity.Valid
}
