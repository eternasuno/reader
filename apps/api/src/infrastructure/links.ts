export const linksSchema = `
DEFINE TABLE IF NOT EXISTS reading_link SCHEMALESS;
DEFINE INDEX IF NOT EXISTS reading_link_owner_url ON reading_link FIELDS owner, url UNIQUE;
DEFINE INDEX IF NOT EXISTS reading_link_owner_read ON reading_link FIELDS owner, read;
`;
