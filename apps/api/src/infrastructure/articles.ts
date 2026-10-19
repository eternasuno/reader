export const articlesSchema = `
DEFINE TABLE IF NOT EXISTS reader_credential SCHEMALESS;
DEFINE INDEX IF NOT EXISTS reader_credential_owner ON reader_credential FIELDS owner UNIQUE;
DEFINE TABLE IF NOT EXISTS article_content SCHEMALESS;
DEFINE INDEX IF NOT EXISTS article_content_owner_url ON article_content FIELDS owner, url UNIQUE;
`;
