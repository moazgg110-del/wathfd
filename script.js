// رحلة الفضاء اللانهائية - نسخة بخادم وسيط لحماية مفتاح API
'use strict';

const DEFAULT_WORKER_URL = localStorage.getItem('space_game_worker_url') || '';
let WORKER_URL = DEFAULT_WORKER_URL.replace(/\/+$/, '');
let chatHistory = [];
let busy = false;

const storyBox = document.getElementById('story-box');
const choicesContainer = document.getElementById('choices-container');
const customActionInput = document.getElementById('custom-action');
const sendActionBtn = document.getElementById('send-action-btn');
const sceneImage = document.getElementById('scene-image');
const imageLoader = document.getElementById('image-loader');

const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
const toggleAboutBtn = document.getElementById('toggle-about-btn');
const settingsPanel = document.getElementById('settings-panel');
const aboutPanel = document.getElementById('about-panel');
const gamePanel = document.getElementById('game-panel');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const closeAboutBtn = document.getElementById('close-about-btn');
const apiKeyInput = document.getElementById('api-key-input');
const saveApiBtn = document.getElementById('save-api-btn');
const apiStatus = document.getElementById('api-status');

const themeDarkBtn = document.getElementById('theme-dark-btn');
const themeLightBtn = document.getElementById('theme-light-btn');
const fontSmallBtn = document.getElementById('font-small-btn');
const fontMediumBtn = document.getElementById('font-medium-btn');
const fontLargeBtn = document.getElementById('font-large-btn');

const systemPrompt = `أنت محرك ذكاء اصطناعي تفاعلي يقود لعبة مغامرة خيال علمي لا تنتهي مصممة ومبرمجة بواسطة معاذ محمد عبد النبي.
اكتب بالعربية الفصحى بأسلوب أدبي مشوق، وواصل أحداث القصة بناءً على قرارات اللاعب.
في نهاية كل رد أخرج بالضبط:
القصة: [الأحداث]
المشهد: [وصف بصري باللغة الإنجليزية]
الخيار 1: [اختيار]
الخيار 2: [اختيار]
الخيار 3: [اختيار]`;

function status(message, type='') {
  if (!apiStatus) return;
  apiStatus.textContent = message;
  apiStatus.className = `api-status ${type}`.trim();
}
function setBusy(value) {
  busy = value;
  if (sendActionBtn) sendActionBtn.disabled = value;
  if (saveApiBtn) saveApiBtn.disabled = value;
  if (customActionInput) customActionInput.disabled = value;
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = value);
}
function appendStoryText(text, cls='story-paragraph') {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  storyBox.appendChild(p);
  storyBox.scrollTop = storyBox.scrollHeight;
}
function requireWorker() {
  if (WORKER_URL) return true;
  status('أدخل عنوان الخادم المنشور أولاً من الإعدادات.', 'warning');
  settingsPanel.classList.remove('hidden');
  gamePanel.classList.remove('hidden');
  appendStoryText('للاتصال بالذكاء الاصطناعي، يلزم نشر الخادم الوسيط الموجود في مجلد worker ثم وضع عنوانه هنا.');
  return false;
}

saveApiBtn?.addEventListener('click', async () => {
  const value = (apiKeyInput?.value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/.+/i.test(value)) {
    status('أدخل عنوان HTTPS صحيحًا للخادم بعد نشره.', 'error');
    return;
  }
  WORKER_URL = value;
  localStorage.setItem('space_game_worker_url', value);
  status('جارٍ اختبار الخادم...', 'pending');
  try {
    const r = await fetch(`${WORKER_URL}/health`, { method:'GET' });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
    status('الخادم يعمل. جارٍ بدء المغامرة...', 'success');
    chatHistory = [];
    await startAdventure();
  } catch (e) {
    status(`تعذر الوصول إلى الخادم: ${e.message}`, 'error');
  }
});

toggleSettingsBtn?.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
  aboutPanel.classList.add('hidden');
  gamePanel.classList.toggle('hidden');
});
toggleAboutBtn?.addEventListener('click', () => {
  aboutPanel.classList.toggle('hidden');
  settingsPanel.classList.add('hidden');
  gamePanel.classList.toggle('hidden');
});
closeSettingsBtn?.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  gamePanel.classList.remove('hidden');
});
closeAboutBtn?.addEventListener('click', () => {
  aboutPanel.classList.add('hidden');
  gamePanel.classList.remove('hidden');
});
themeDarkBtn?.addEventListener('click', () => {
  document.body.classList.remove('light-mode');
  themeDarkBtn.classList.add('active');
  themeLightBtn.classList.remove('active');
});
themeLightBtn?.addEventListener('click', () => {
  document.body.classList.add('light-mode');
  themeLightBtn.classList.add('active');
  themeDarkBtn.classList.remove('active');
});
fontSmallBtn?.addEventListener('click', () => setFontSize('0.9rem', fontSmallBtn));
fontMediumBtn?.addEventListener('click', () => setFontSize('1.05rem', fontMediumBtn));
fontLargeBtn?.addEventListener('click', () => setFontSize('1.2rem', fontLargeBtn));
function setFontSize(size, btn) {
  document.documentElement.style.setProperty('--font-size', size);
  [fontSmallBtn,fontMediumBtn,fontLargeBtn].forEach(b => b?.classList.remove('active'));
  btn?.classList.add('active');
}

sendActionBtn?.addEventListener('click', () => {
  const action = customActionInput.value.trim();
  if (action && !busy) { customActionInput.value=''; progressStory(action); }
});
customActionInput?.addEventListener('keydown', e => { if (e.key === 'Enter') sendActionBtn.click(); });

async function postWithRetry(path, body, maxAttempts=4) {
  let lastError;
  for (let attempt=0; attempt<maxAttempts; attempt++) {
    try {
      const response = await fetch(`${WORKER_URL}${path}`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
      const message = data.error || `HTTP ${response.status}`;
      // Retry only transient server/rate errors, not invalid key or malformed requests.
      if (![408,429,500,502,503,504].includes(response.status)) {
        throw new Error(message);
      }
      lastError = new Error(message);
    } catch (e) {
      lastError = e;
      if (e instanceof TypeError && attempt === maxAttempts-1) throw e;
    }
    if (attempt < maxAttempts-1) {
      const delay = Math.min(12000, 1000 * (2 ** attempt)) + Math.floor(Math.random()*400);
      status(`الخدمة مشغولة. إعادة المحاولة ${attempt+1} من ${maxAttempts-1}...`, 'pending');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('تعذر الاتصال بعد عدة محاولات.');
}

async function callStory(promptText) {
  if (!requireWorker() || busy) return null;
  const nextHistory = [...chatHistory, {role:'user', parts:[{text:promptText}]}].slice(-24);
  setBusy(true);
  appendStoryText('جاري تجهيز أحداث المغامرة بالذكاء الاصطناعي...', 'loading-text');
  try {
    const result = await postWithRetry('/api/story', {systemPrompt, contents:nextHistory});
    if (!result.text) throw new Error('وصل رد فارغ من محرك القصة.');
    chatHistory = [...nextHistory, {role:'model',parts:[{text:result.text}]}].slice(-24);
    status(`الاتصال يعمل باستخدام ${result.model || 'Gemini'}.`, 'success');
    return result.text;
  } catch (e) {
    appendStoryText(`تعذر توليد القصة: ${e.message}`, 'error-msg');
    status('تعذر الاتصال بعد محاولات تلقائية. يمكنك المحاولة مجددًا.', 'error');
    return null;
  } finally {
    document.querySelectorAll('.loading-text').forEach(el=>el.remove());
    setBusy(false);
  }
}

async function updateSceneImage(prompt) {
  imageLoader.classList.remove('hidden');
  sceneImage.classList.add('hidden');
  imageLoader.textContent = 'جاري توليد صورة المشهد... 🎨';
  try {
    const result = await postWithRetry('/api/image', {prompt}, 2);
    if (result.imageData) {
      sceneImage.onload = () => {
        imageLoader.classList.add('hidden');
        sceneImage.classList.remove('hidden');
      };
      sceneImage.onerror = () => { imageLoader.textContent='تعذر عرض الصورة؛ يمكنك متابعة القصة.'; };
      sceneImage.src = `data:${result.mimeType || 'image/png'};base64,${result.imageData}`;
      return;
    }
    throw new Error(result.error || 'لم تصل صورة من الخادم.');
  } catch (e) {
    // Visual fallback keeps the story playable if image generation is unavailable.
    const fallback = `https://image.pollinations.ai/prompt/${encodeURIComponent('sci-fi space adventure concept art, '+prompt)}?width=800&height=400&nologo=true`;
    sceneImage.onload = () => { imageLoader.classList.add('hidden'); sceneImage.classList.remove('hidden'); };
    sceneImage.onerror = () => { imageLoader.textContent='خدمة الصور غير متاحة الآن. القصة ما زالت تعمل.'; };
    sceneImage.src = fallback;
  }
}

async function startAdventure() {
  if (!requireWorker()) return;
  storyBox.innerHTML = '';
  choicesContainer.innerHTML = '';
  const reply = await callStory('ابدأ القصة: استيقظ البطل فجأة داخل كبسولة الأمان بمحطة فضائية مهجورة تدور حول كوكب مجهول، والإنذار الأحمر يضيء والممر الرئيسي مظلم تماماً.');
  if (reply) parseAndDisplayResponse(reply);
}
async function progressStory(action) {
  if (busy) return;
  appendStoryText(`إجراءك الحالي: ${action}`, 'user-action');
  const reply = await callStory(`إجراء اللاعب: ${action}. واصل سرد المغامرة وأعطني أحداثاً جديدة ووصفاً للمشهد بالإنجليزية وثلاثة خيارات.`);
  if (reply) parseAndDisplayResponse(reply);
}
function parseAndDisplayResponse(text) {
  const choices=[];
  let imagePrompt='futuristic abandoned space station, red emergency lights';
  const story=[];
  for (const raw of text.split('\n')) {
    const line=raw.trim();
    if (/^المشهد\s*:/i.test(line)) imagePrompt=line.replace(/^المشهد\s*:/i,'').trim();
    else if (/^الخيار\s*[123]\s*:/i.test(line)) {
      const c=line.replace(/^الخيار\s*[123]\s*:/i,'').trim();
      if(c) choices.push(c);
    } else if(line) story.push(line.replace(/^القصة\s*:\s*/i,''));
  }
  appendStoryText(story.join('\n') || text);
  updateSceneImage(imagePrompt);
  displayChoices(choices.length ? choices.slice(0,3) : [
    'استكشاف لوحة التحكم الإلكترونية بجانب الباب.',
    'البحث في صناديق الإمدادات عن أداة مفيدة.',
    'التقدم بحذر نحو الممر واستكشاف مصدر الصوت.'
  ]);
}
function displayChoices(items) {
  choicesContainer.innerHTML='';
  items.forEach((choice,index)=>{
    const b=document.createElement('button');
    b.className='choice-btn';
    b.textContent=`الخيار ${index+1}: ${choice}`;
    b.addEventListener('click',()=>progressStory(choice));
    choicesContainer.appendChild(b);
  });
}

window.addEventListener('DOMContentLoaded',()=>{
  if (apiKeyInput) apiKeyInput.value = WORKER_URL;
  if (!WORKER_URL) {
    storyBox.innerHTML='';
    appendStoryText('مرحباً بك! يلزم إعداد عنوان الخادم الوسيط مرة واحدة من الإعدادات قبل بدء المغامرة.');
    status('لم يتم إعداد عنوان الخادم بعد.', 'warning');
  } else {
    startAdventure();
  }
});
