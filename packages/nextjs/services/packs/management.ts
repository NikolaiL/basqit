/** Creation settings accepted by BasqitFactory; percentages are entered in percent and sent in basis points. */
export function basketManagement(managed: boolean, notice: string, slippage: string) {
  if (!managed) return { managed: false, noticeHours: 0, maxSlippageBps: 0 };
  const noticeHours = Number(notice.trim());
  const percent = Number(slippage.trim());
  if (
    !/^\d+$/.test(notice.trim()) ||
    !Number.isInteger(noticeHours) ||
    noticeHours > 72 ||
    !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(slippage.trim()) ||
    percent < 0.1 ||
    percent > 2
  )
    return null;
  return { managed: true, noticeHours, maxSlippageBps: Math.round(percent * 100) };
}
