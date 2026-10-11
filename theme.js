// Apply before styles load. Normal saves retain the system preference.
(() => {
 let saved;
 try { saved = JSON.parse(localStorage.getItem('quiet-signal-v1') || '{}').theme; } catch {}
 const theme = saved === 'light' || saved === 'dark' ? saved : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
 document.documentElement.classList.toggle('dark', theme === 'dark');
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#e7ebef' : '#0b111a');
})();
