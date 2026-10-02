export function Brand() {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 40 44" fill="none" aria-hidden="true">
        <path d="M20 2 38 12v20L20 42 2 32V12L20 2Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="m20 2 11 29H9L20 2ZM2 12l7 19 11 11 11-11 7-19M2 12h36M9 31l11-19 11 19" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span>roll<span className="brand-amp">&</span>play<span className="brand-dot">.</span></span>
    </span>
  );
}
