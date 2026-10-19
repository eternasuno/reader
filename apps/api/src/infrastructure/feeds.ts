export const feedsSchema = `
DEFINE TABLE IF NOT EXISTS feed SCHEMALESS;
DEFINE INDEX IF NOT EXISTS feed_owner_url ON feed FIELDS owner, url UNIQUE;
DEFINE TABLE IF NOT EXISTS feed_article SCHEMALESS;
DEFINE INDEX IF NOT EXISTS feed_article_owner_feed ON feed_article FIELDS owner, feedKey;
`;
