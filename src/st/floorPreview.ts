const THINKING_BLOCK_PATTERN =
  /<(think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_THINKING_BLOCK_PATTERN =
  /<(think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*$/gi;

/** 仅供楼层列表展示，不得将结果写回聊天消息或工作区。 */
export function buildFloorPreview(rawText: string): string {
  return (
    rawText
      .replace(THINKING_BLOCK_PATTERN, ' ')
      .replace(UNCLOSED_THINKING_BLOCK_PATTERN, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || '（无正文预览）'
  );
}
