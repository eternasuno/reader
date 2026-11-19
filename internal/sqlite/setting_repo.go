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

func buildKindleSettings(s settingsRow) *domain.KindleSettings {
	if !hasKindleDelivery(s.kindleEmail, s.senderEmail, s.smtpHost, s.smtpPort, s.smtpSecurity) {
		return nil
	}

	return &domain.KindleSettings{
		KindleEmail:  s.kindleEmail.String,
		SenderEmail:  s.senderEmail.String,
		SMTPHost:     s.smtpHost.String,
		SMTPPort:     int(s.smtpPort.Int64),
		SMTPSecurity: domain.SMTPSecurity(s.smtpSecurity.String),
		SMTPUser:     optionalText(s.smtpUser),
		SMTPPassword: optionalText(s.smtpPassword),
		SendTime:     optionalText(s.sendTime),
		NextSendAt:   optionalMillis(s.nextSendAt),
	}
}

func (r *SettingRepo) UpdateRetention(ctx context.Context, retention int) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET retention = ? WHERE id = 1`, retention); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) UpdateFetcherDirect(ctx context.Context) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET provider = 'direct' WHERE id = 1`); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) UpdateFetcherJina(ctx context.Context, key *string) error {
	var err error
	if key != nil && strings.TrimSpace(*key) != "" {
		_, err = r.write.ExecContext(
			ctx,
			`UPDATE setting SET provider = 'jina', jina_key = ? WHERE id = 1`,
			strings.TrimSpace(*key),
		)
	} else {
		_, err = r.write.ExecContext(ctx, `UPDATE setting SET provider = 'jina' WHERE id = 1`)
	}

	if err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) UpdateFetcherBrowser(ctx context.Context, endpoint *string) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		if endpoint != nil && strings.TrimSpace(*endpoint) != "" {
			_, err := tx.ExecContext(
				ctx,
				`UPDATE setting SET provider = 'browser', browser_endpoint = ? WHERE id = 1`,
				strings.TrimSpace(*endpoint),
			)

			return err
		}

		var stored sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT browser_endpoint FROM setting WHERE id = 1`).Scan(&stored); err != nil {
			return err
		}

		if !stored.Valid || strings.TrimSpace(stored.String) == "" {
			return domain.NewError(domain.ErrBrowserEndpointRequired, nil)
		}

		_, err := tx.ExecContext(ctx, `UPDATE setting SET provider = 'browser' WHERE id = 1`)

		return err
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func (r *SettingRepo) DeleteJinaKey(ctx context.Context) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET jina_key = NULL WHERE id = 1`); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) UpdateKindle(ctx context.Context, kindle domain.KindleSettings) error {
	query := `UPDATE setting SET kindle_email = ?, sender_email = ?, smtp_host = ?, smtp_port = ?, smtp_security = ?, smtp_user = ?, send_time = ?, next_send_at = ?`
	args := []any{
		kindle.KindleEmail,
		kindle.SenderEmail,
		kindle.SMTPHost,
		kindle.SMTPPort,
		string(kindle.SMTPSecurity),
		optionalString(kindle.SMTPUser),
		optionalString(kindle.SendTime),
		optionalTime(kindle.NextSendAt),
	}

	if kindle.SMTPPassword != nil && strings.TrimSpace(*kindle.SMTPPassword) != "" {
		query += `, smtp_password = ?`
		args = append(args, *kindle.SMTPPassword)
	}

	query += ` WHERE id = 1`

	if _, err := r.write.ExecContext(ctx, query, args...); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) DeleteKindlePassword(ctx context.Context) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET smtp_password = NULL WHERE id = 1`); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *SettingRepo) AdvanceNextSendAt(ctx context.Context, nextSendAt time.Time) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE setting SET next_send_at = ? WHERE id = 1`, timeToMillis(nextSendAt)); err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func hasKindleDelivery(kindleEmail sql.NullString, senderEmail sql.NullString, smtpHost sql.NullString, smtpPort sql.NullInt64, smtpSecurity sql.NullString) bool {
	return kindleEmail.Valid && senderEmail.Valid && smtpHost.Valid && smtpPort.Valid && smtpSecurity.Valid
}
