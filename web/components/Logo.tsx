/// The product mark: the price curve every launch actually walks.
///
/// Deliberately not a letterform. The old "A" tile could be read as standing
/// for Arc, which the brand guidelines specifically warn against — this mark
/// means something about the product instead, and survives a rename.
///
/// Drawn on a 48×48 grid with a hard offset shadow so it sits inside the same
/// neo-brutalist system as the rest of the UI.
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      className={className}
      aria-hidden
      focusable="false"
    >
      {/* offset shadow — the brutalist drop the whole UI uses */}
      <rect x="6" y="6" width="44" height="44" fill="#93bf1f" />
      {/* face */}
      <rect x="2" y="2" width="44" height="44" fill="#c8ff2e" stroke="#08080a" strokeWidth="2.5" />
      {/* the curve: flat and cheap early, vertical near the ceiling */}
      <path
        d="M8 39 C 22 39, 31 34, 38 10"
        fill="none"
        stroke="#08080a"
        strokeWidth="6.5"
        strokeLinecap="square"
      />
      {/* ceiling marker */}
      <rect x="33" y="6" width="9" height="9" fill="#08080a" />
      {/* start marker */}
      <rect x="6" y="36" width="6" height="6" fill="#ff3d8b" />
    </svg>
  );
}

/// Full lockup: mark plus wordmark. `name` is passed in rather than hardcoded so
/// a rename touches one config value, not this file.
export function Logo({
  name,
  accent,
  size = 32,
}: {
  name: string;
  accent?: string;
  size?: number;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-lg font-bold tracking-tight">
        {name}
        {accent ? <span className="text-lime">{accent}</span> : null}
      </span>
    </span>
  );
}
