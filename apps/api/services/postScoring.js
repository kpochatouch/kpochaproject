// apps/api/services/postScoring.js
export function scoreFrom(stats = {}) {
  const v = Number(stats.viewsCount || 0);
  const l = Number(stats.likesCount || 0);
  const c = Number(stats.commentsCount || 0);
  const sh = Number(stats.sharesCount || 0);
  const sv = Number(stats.savesCount || 0);

  // You can tweak these weights later in one place
  return l * 3 + c * 4 + sh * 5 + sv * 2 + v * 0.2;
}
