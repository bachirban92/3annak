export function icon(name){
  const icons={
    plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    orders:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/></svg>',
    briefcase:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v11H4zM9 8V5h6v3M4 12h16"/></svg>',
    wallet:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v11H4zM4 7l2-3h11l3 3M15 12h5"/></svg>',
    check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6"/></svg>',
    map:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>',
    settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
  };
  return icons[name]||'';
}
