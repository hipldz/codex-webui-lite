import codexLogo from "../assets/codex.svg";

export function CodexLogo({ className = "" }: { className?: string }) {
  return <img className={`codex-logo ${className}`} src={codexLogo} alt="" aria-hidden="true" />;
}
