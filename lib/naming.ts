/**
 * プレフィックス命名ヘルパー。
 *
 * 通常モードと Express モードのスタックを削除せずに共存させるため、
 * スタック名や「物理名を明示する必要のあるリソース」にプレフィックスを付与して
 * 名前衝突を回避する。物理名を指定しないリソースは CDK がスタック名込みで
 * 一意な名前を自動生成するため、原則としてプレフィックス付与は不要。
 */
export function withPrefix(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}
