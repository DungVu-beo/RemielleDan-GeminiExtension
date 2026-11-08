const DEFAULTS = {
  enabled: true,
  showKiss: true,
  showMascot: true,
  lockPos: false,
  kissSize: 200,
  mascotSize: 170,
  opacity: 100,
  kissPos: null,
  mascotPos: null
};

const toggles = ['enabled', 'showKiss', 'showMascot', 'lockPos'];
const ranges = { kissSize: 'px', mascotSize: 'px', opacity: '%' };

chrome.storage.local.get(DEFAULTS, (s) => {
  toggles.forEach((id) => {
    const el = document.getElementById(id);
    el.checked = !!s[id];
    el.addEventListener('change', () => chrome.storage.local.set({ [id]: el.checked }));
  });

  Object.entries(ranges).forEach(([id, unit]) => {
    const el = document.getElementById(id);
    const out = document.getElementById(id + 'Val');
    el.value = s[id];
    out.textContent = s[id] + unit;
    el.addEventListener('input', () => {
      out.textContent = el.value + unit;
      chrome.storage.local.set({ [id]: Number(el.value) });
    });
  });
});

document.getElementById('resetPos').addEventListener('click', () => {
  chrome.storage.local.set({ kissPos: null, mascotPos: null });
});
