import Link from "next/link";

type BrandLogoProps = { href?: string; compact?: boolean; dark?: boolean; className?: string };

export function BrandIcon({ dark = false }: { dark?: boolean }) {
  return <span className={`brand-icon${dark ? " brand-icon-dark" : ""}`} aria-hidden="true">O</span>;
}

export function BrandWordmark({ dark = false }: { dark?: boolean }) {
  return <span className={`brand-wordmark${dark ? " brand-wordmark-dark" : ""}`}><span>OUTLIV</span><i>O</i></span>;
}

export function BrandLogo({ href = "/", compact = false, dark = false, className = "" }: BrandLogoProps) {
  const content = compact ? <BrandIcon dark={dark} /> : <><BrandIcon dark={dark} /><BrandWordmark dark={dark} /></>;
  return href ? <Link className={`brand-logo ${className}`} href={href} aria-label="Outlivo home">{content}</Link> : <span className={`brand-logo ${className}`}>{content}</span>;
}
