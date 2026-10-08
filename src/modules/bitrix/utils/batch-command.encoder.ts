/**
 * Builds one command of a Bitrix24 `batch` call: `method?query`, where nested parameters use
 * PHP bracket keys (`fields[fm][0][value]=…`). Keys and values are percent-encoded, so `&`, `=`,
 * `+` and non-ASCII text inside a value cannot break the query apart.
 */
export function encodeBatchCommand(method: string, params: Record<string, unknown>): string {
  const pairs: string[] = [];

  const walk = (key: string, value: unknown): void => {
    if (value === undefined) return;
    if (value === null) {
      pairs.push(`${key}=`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${key}[${index}]`, item));
    } else if (typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) {
        walk(`${key}[${encodeURIComponent(name)}]`, item);
      }
    } else {
      pairs.push(`${key}=${encodeURIComponent(value as string | number | boolean)}`);
    }
  };

  for (const [name, value] of Object.entries(params)) walk(encodeURIComponent(name), value);
  return pairs.length ? `${method}?${pairs.join('&')}` : method;
}
