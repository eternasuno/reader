/** The text of a form field; a missing field is empty rather than null. */
export const fieldValue = (data: FormData, name: string): string => {
  const value = data.get(name);

  return typeof value === 'string' ? value : '';
};
