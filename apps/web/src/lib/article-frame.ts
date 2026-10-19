export const articleFrameHeight = (
  event: { source: unknown; data: unknown },
  frameWindow: unknown,
  token: string
): number | undefined => {
  if (!frameWindow || event.source !== frameWindow) return;

  const data = event.data;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('type' in data) ||
    data.type !== 'article-frame-resize' ||
    !('token' in data) ||
    data.token !== token ||
    !('height' in data) ||
    typeof data.height !== 'number' ||
    !Number.isFinite(data.height) ||
    data.height < 1 ||
    data.height > 1_000_000
  )
    return;

  return Math.ceil(data.height);
};
