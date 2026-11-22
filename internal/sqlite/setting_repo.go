package sqlite

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"reader/internal/domain"
)

const settingColumns = `retention, provider, jina_key, browser_endpoint, kindle_email, sender_email, smtp_host, smtp_port, smtp_security, smtp_user, smtp_password, send_time, next_send_at`

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
	sendTime        sql.NullString
	nextSendAt      sql.NullInt64
}

func (r *SettingRepo) Get(ctx context.Context) (domain.Settings, error) {
	row, err := scanSettingsRow(r.read.QueryRowContext(ctx, `SELECT `+settingColumns+` FROM setting WHERE id = 1`))
	if err != nil {
		return domain.Settings{}, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return domain.Settings{
		Retention:       int(row.retention),
		Provider:        domain.ExtractorProvider(row.provider),
		JinaKey:         optionalText(row.jinaKey),
		BrowserEndpoint: optionalText(row.browserEndpoint),
		SMTP:            buildSMTPSettings(row),
		Kindle:          buildKindleSettings(row),
	}, nil
}

func scanSettingsRow(row *sql.Row) (settingsRow, error) {
	var s settingsRow
	err := row.Scan(
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
		&s.sendTime,
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
		SendTime:    optionalText(s.sendTime),
		NextSendAt:  optionalMillis(s.nextSendAt),
	}
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

			if !stored.Valid || strings.TrimSpace(stored.String) == "" {
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

func (r *SettingRepo) UpdateKindle(ctx context.Context, kindle domain.KindleSettings) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var senderEmail sql.NullString
		var smtpHost sql.NullString
		var smtpPort sql.NullInt64
		var smtpSecurity sql.NullString
		err := tx.QueryRowContext(
			ctx,
			`SELECT sender_email, smtp_host, smtp_port, smtp_security FROM setting WHERE id = 1`,
		).Scan(&senderEmail, &smtpHost, &smtpPort, &smtpSecurity)
		if err != nil {
			return err
		}

		if !hasSMTPSettings(senderEmail, smtpHost, smtpPort, smtpSecurity) {
			return domain.NewError(domain.ErrSMTPNotConfigured, nil)
		}

		_, err = tx.ExecContext(
			ctx,
			`UPDATE setting SET kindle_email = ?, send_time = ?, next_send_at = ? WHERE id = 1`,
			kindle.KindleEmail,
			optionalString(kindle.SendTime),
			optionalTime(kindle.NextSendAt),
		)

		return err
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func (r *SettingRepo) AdvanceNextSendAt(ctx context.Context, nextSendAt time.Time) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET next_send_at = ? WHERE id = 1`, timeToMillis(nextSendAt)); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func hasSMTPSettings(senderEmail sql.NullString, smtpHost sql.NullString, smtpPort sql.NullInt64, smtpSecurity sql.NullString) bool {
	return senderEmail.Valid && smtpHost.Valid && smtpPort.Valid && smtpSecurity.Valid
}
