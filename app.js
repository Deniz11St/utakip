// --- CLOUD SYNC ENGINE (Firebase Runtime) ---
let firebaseApp = null;
let firebaseDb = null;

function initCloudSync() {
    const data = dataManager.data;
    const authOverlay = document.getElementById('authOverlay');

    // Eğer config yoksa ama kullanıcı giriş yapmamışsa yine de overlay'i göster
    if (!data.firebaseApiKey || !data.firebaseDbUrl || !data.firebaseAuthDomain) {
        console.log("Cloud Sync config missing, but checking auth status...");
    }

    const firebaseConfig = {
        apiKey: data.firebaseApiKey,
        databaseURL: data.firebaseDbUrl,
        authDomain: data.firebaseAuthDomain
    };

    try {
        if (!window.firebase) {
            console.error("Firebase SDK not loaded.");
            return;
        }
        
        if (!data.firebaseApiKey) {
            console.warn("Firebase API Key missing. Cloud Sync features disabled.");
            return;
        }

        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(firebaseConfig);
        } else {
            firebaseApp = firebase.app();
        }

        // Initialize Database ONLY if URL is valid (v2.5.6 Fix)
        if (data.firebaseDbUrl && data.firebaseDbUrl.startsWith('http')) {
            firebaseDb = firebaseApp.database();
            console.log("Firebase Database Initialized.");
        } else {
            console.warn("Firebase Database URL missing/invalid. Real-time sync disabled.");
        }

        console.log("Firebase Initialized Successfully.");

        // Auth Listener (v2.5.0) - Sadece bir kez ekle
        if (!window.authListenerAttached) {
            firebase.auth().onAuthStateChanged(user => {
            const authOverlay = document.getElementById('authOverlay');
            if (user) {
                console.log("User logged in:", user.email);
                if (authOverlay) authOverlay.classList.add('hidden');
                
                // Display user email in settings (v2.5.3)
                const emailDisplay = document.getElementById('displayUserEmail');
                if (emailDisplay) emailDisplay.textContent = user.email;
                
                // Sync data with User UID
                dataManager.data.firebaseSyncId = user.uid;
                dataManager.save(true);
                
                // Real-time Database Listener
                const syncRef = firebaseDb.ref('users/' + user.uid);
                syncRef.on('value', (snapshot) => {
                    const remoteData = snapshot.val();
                    if (remoteData && (dataManager.data.lastSyncTimestamp === 0 || remoteData.lastSyncTimestamp > dataManager.data.lastSyncTimestamp)) {
                        console.log("Cloud data is newer or local is empty, pulling...");
                        dataManager.data = remoteData;
                        dataManager.sanitize();
                        dataManager.save(true);
                        if (window.updateHomeView) window.updateHomeView();
                        if (window.updateCalendarView) window.updateCalendarView();
                        if (window.updateTimerDisplay) window.updateTimerDisplay();
                        if (window.updateSettingsView) window.updateSettingsView();
                    }
                });
            } else {
                console.log("User logged out.");
                if (authOverlay) authOverlay.classList.remove('hidden');
                }
            });
            window.authListenerAttached = true;
        }
    } catch (e) {
        console.error("Firebase Init Error:", e);
    }
}

function cloudSyncPush(manualData) {
    const data = manualData || (typeof dataManager !== 'undefined' ? dataManager.data : null);
    if (!data || !firebaseDb || !data.cloudSyncEnabled || !data.firebaseSyncId) return;
    
    // KORUMA: Eğer lokal veri tamamen boşsa ve hiç senkronize olmamışsa, buluttaki veriyi ezmeyi engelle
    if (data.lastSyncTimestamp === 0 && !data.name && !data.startDate && Object.keys(data.sessions || {}).length === 0) {
        console.warn("Cloud Sync: Local data is empty. Preventing push to avoid overwriting cloud data.");
        return;
    }
    
    // O anki lokal timestamp'i (son başarılı senkronizasyon zamanını) bir değişkene al
    const localPreviousTimestamp = data.lastSyncTimestamp;
    
    // Derin kopya alarak push edilecek veriyi hazırla ve YENİ timestamp'ini ata
    const newDataToPush = JSON.parse(JSON.stringify(data));
    newDataToPush.lastSyncTimestamp = Date.now();
    
    const syncRef = firebaseDb.ref('users/' + data.firebaseSyncId);
    
    // Firebase Transaction (Çakışma Önleyici Sistem)
    syncRef.transaction((currentRemoteData) => {
        // Eğer bulutta hiç veri yoksa (ilk defa kayıt yapılıyorsa), veriyi yaz
        if (currentRemoteData === null) {
            return newDataToPush; 
        }
        
        // KRİTİK KONTROL: Eğer buluttaki veri, bizim en son bildiğimiz (senkronize olduğumuz) veriden 
        // daha yeniyse (yani aradaki sürede başka cihaz veri girmişse), YAZMA İŞLEMİNİ İPTAL ET.
        // Not: Transaction içinde undefined dönersek işlem iptal edilir (aborted).
        if (currentRemoteData.lastSyncTimestamp && currentRemoteData.lastSyncTimestamp > localPreviousTimestamp) {
            return undefined; // PUSH iptal
        }
        
        // Eğer buluttaki veri bizimkinden eskiyse veya aynıysa, veriyi güvenle ezebiliriz (bizimki güncel)
        return newDataToPush;
        
    }, (error, committed, snapshot) => {
        if (error) {
             console.error("Cloud Sync Transaction Error:", error);
        } else if (!committed) {
             console.warn("🛡️ Cloud Sync Conflict Prevented: Cloud data is newer! Aborting Push and pulling fresh data.");
             
             // İşlem iptal edildi, yani buluttaki veri daha güncel. O halde buluttaki güncel veriyi bilgisayara indirelim.
             const remoteData = snapshot.val();
             if (remoteData && typeof dataManager !== 'undefined') {
                 dataManager.data = remoteData;
                 dataManager.sanitize();
                 dataManager.save(true); // skipCloud = true (Tekrar push döngüsüne girmesini engeller)
                 
                 // Ekranda açık olan tüm bileşenleri buluttan gelen taze verilerle yenile
                 if (window.updateHomeView) window.updateHomeView();
                 if (window.updateCalendarView) window.updateCalendarView();
                 if (window.updateTimerDisplay) window.updateTimerDisplay();
                 if (window.updateSettingsView) window.updateSettingsView();
                 
                 console.log("Local UI updated successfully with fresh cloud data.");
             }
        } else {
             // Transaction başarılı! Buluta yeni veri (ve yeni timestamp) PUSH edildi. 
             // Şimdi bilgisayardaki lokal verimizin de timestamp'ini güncelleyelim.
             if (typeof dataManager !== 'undefined') {
                 dataManager.data.lastSyncTimestamp = newDataToPush.lastSyncTimestamp;
                 localStorage.setItem('uTakipData', JSON.stringify(dataManager.data)); // Sessizce localStorage'ı güncelle
             }
             console.log("Cloud Sync Push Successful (Transaction Guarded)");
        }
    });
}

async function cloudSyncPullManual() {
    if (!firebaseDb) return;
    const syncRef = firebaseDb.ref('users/' + dataManager.data.firebaseSyncId);
    try {
        const snapshot = await syncRef.once('value');
        const remoteData = snapshot.val();
        if (remoteData) {
            dataManager.data = remoteData;
            dataManager.sanitize(); // v2.4.2 Fix
            dataManager.save(true);
            if (window.updateHomeView) window.updateHomeView();
            if (window.updateSettingsView) window.updateSettingsView();
            return true;
        }
    } catch (e) {
        console.error("Manual Pull Error:", e);
    }
    return false;
}

// Başarı bildirimi (Achievement Pop-up)
function showSuccessAchievement(title, message, icon = '🏆') {
    const el = document.createElement('div');
    el.className = 'success-achievement';
    el.innerHTML = `<span class="icon">${icon}</span> <span><strong>${title}</strong>: ${message}</span>`;
    document.body.appendChild(el);
    
    // Animasyonu tetikle
    setTimeout(() => el.classList.add('show'), 100);
    
    // 4 saniye sonra kaldır
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 600);
    }, 4000);
}


// Core Data Management (localStorage)
class TrackerData {
    constructor() {
        this.sessionAchievements = { daily: false, target: false };
        this.load();
    }

    load() {
        const defaultData = {
            name: '',
            age: 0,
            startDate: '',
            startSize: 0, // In cm
            currentSize: 0, // In cm
            targetSize: 0, // In cm
            targetMonthlyGrowth: 2, // In mm
            sessions: {}, // Format: "YYYY-MM-DD": [{mins: 120, diff: 'normal'}, {mins: 60, diff: 'zor'}]
            monthlyTension: {}, // Format: "YYYY-MM": 10.5 (cm)
            notes: {}, // Format: "YYYY-MM-DD": "Bugün seans çok verimliydi."
            coachChat: [], // Format: [{role: 'user', text: '...'}, {role: 'coach', text: '...'}]
            geminiApiKey: 'AIzaSyAY4X11SOje4b4GfQBF8ENHl4HYZuM8-Ik',
            minimaxApiKey: '',
            geminiModelName: 'gemini-2.5-flash',
            aiProvider: 'gemini', // 'gemini' or 'minimax'
            dailyGoalHours: 6,
            timerSettings: {
                count: 3,
                duration: 120, // mins
                break: 30, // mins
                sound: true,
                vibrate: true
            },
            dailyPump: {}, // Format: "YYYY-MM-DD": true
            dailyScrewSize: {}, // Format: "YYYY-MM-DD": 14 (mm cinsinden vida boyutu)
            firebaseApiKey: 'AIzaSyBGrnSSeLSY_XvnhxZRjH8kk5uRb-JHdwk',
            firebaseDbUrl: 'https://utakip-sync-default-rtdb.europe-west1.firebasedatabase.app',
            firebaseAuthDomain: 'utakip-sync.firebaseapp.com',
            firebaseSyncId: '',
            cloudSyncEnabled: true,
            lastSyncTimestamp: 0,
            activeSessionState: {
                current: 1,
                mode: 'ready', // 'ready', 'work', 'break'
                startTime: 0,
                lastModeChange: 0
            },
            workCycleDays: 5,
            restCycleDays: 2,
            monthlyWork: {} // Format: "YYYY-MM": minutes
        };
        const raw = localStorage.getItem('uTakipData');
        try {
            if (raw && raw !== "undefined" && raw !== "null") {
                this.data = JSON.parse(raw);
            } else {
                this.data = Object.assign({}, defaultData);
            }
        } catch (e) {
            console.error("Veri yukleme hatasi (Storage Corrupted):", e);
            this.data = Object.assign({}, defaultData);
        }
        
        if (!this.data) this.data = Object.assign({}, defaultData);
        
        this.sanitize();
    }

    sanitize() {
        if (!this.data) return;
        
        // Ensure core objects exist
        const ensureObjects = [
            'sessions', 'monthlyTension', 'monthlySize', 'notes', 
            'dailyPump', 'dailyScrewSize', 'monthlyWork', 'restDays'
        ];
        ensureObjects.forEach(k => {
            if (!this.data[k] || typeof this.data[k] !== 'object') this.data[k] = {};
        });

        if (!Array.isArray(this.data.coachChat)) this.data.coachChat = [];
        
        if (!this.data.timerSettings) {
            this.data.timerSettings = { count: 3, duration: 120, break: 30, sound: true, vibrate: true };
        }
        
        if (!this.data.activeSessionState) {
            this.data.activeSessionState = { current: 1, mode: 'ready', startTime: 0, lastModeChange: 0 };
        }

        // Defaults for primitives
        if (this.data.targetMonthlyGrowth === undefined) this.data.targetMonthlyGrowth = 2;
        if (this.data.dailyGoalHours === undefined) this.data.dailyGoalHours = 6;
        if (this.data.workCycleDays === undefined) this.data.workCycleDays = 5;
        if (this.data.restCycleDays === undefined) this.data.restCycleDays = 2;
        if (this.data.cloudSyncEnabled === undefined) this.data.cloudSyncEnabled = true;
        if (this.data.lastSyncTimestamp === undefined) this.data.lastSyncTimestamp = 0;
        
        // AUTO-FILL Missing Firebase Config (v2.5.7)
        if (!this.data.firebaseApiKey) this.data.firebaseApiKey = 'AIzaSyBGrnSSeLSY_XvnhxZRjH8kk5uRb-JHdwk';
        if (!this.data.firebaseDbUrl) this.data.firebaseDbUrl = 'https://utakip-sync-default-rtdb.europe-west1.firebasedatabase.app';
        if (!this.data.firebaseAuthDomain) this.data.firebaseAuthDomain = 'utakip-sync.firebaseapp.com';

        // AUTO-FILL Missing Gemini API Key
        if (!this.data.geminiApiKey) this.data.geminiApiKey = 'AIzaSyAY4X11SOje4b4GfQBF8ENHl4HYZuM8-Ik';

        // MIGRATION: Sessions data integrity
        if (this.data.sessions) {
            Object.keys(this.data.sessions).forEach(k => {
                if (!Array.isArray(this.data.sessions[k])) {
                    // If it's not an array, it's corrupted data for this key
                    this.data.sessions[k] = [];
                    return;
                }
                this.data.sessions[k] = this.data.sessions[k].map(item => {
                    return typeof item === 'number' ? { mins: item, diff: 'normal' } : item;
                });
            });
        }
    }

    setTimerSettings(count, duration, breakMins, sound, vibrate) {
        this.data.timerSettings = {
            count: parseInt(count) || 3,
            duration: parseInt(duration) || 120,
            break: parseInt(breakMins) || 30,
            sound: !!sound,
            vibrate: !!vibrate
        };
        this.save();
    }

    resetActiveSession() {
        this.data.activeSessionState = {
            current: 1,
            mode: 'ready',
            startTime: 0,
            lastModeChange: Date.now()
        };
        this.data.timerStartTime = 0;
        this.save();
    }

    save(skipCloud = false) {
        // Transaction (v2.6.2): lastSyncTimestamp'i BURADA güncellemiyoruz. cloudSyncPush başarılı olunca güncelleyecek.
        // Bu sayede buluttaki veri bizden yeniyse (Conflict), eski timestamp'imizi bulutla karşılaştırıp ezilmesini engelleyebiliyoruz.
        localStorage.setItem('uTakipData', JSON.stringify(this.data));
        
        if (this.data.cloudSyncEnabled && !skipCloud) {
            cloudSyncPush(this.data);
        }
    }

    // Setters
    setBaseSettings(name, age, date, size, target, growthRate, apiKey = '', modelName = 'gemini-1.5-flash', dailyGoal = 6, aiProvider = 'gemini', minimaxKey = '', fbKey = '', fbUrl = '', fbId = '', fbEnabled = false, workCycle = 5, restCycle = 1, fbAuth = '') {
        this.data.name = name;
        this.data.age = parseInt(age) || 0;
        this.data.startDate = date;
        
        const parsedSize = parseFloat(size);
        const oldStartSize = this.data.startSize;
        this.data.startSize = isNaN(parsedSize) ? 0 : parsedSize;
        
        if (!this.data.currentSize || this.data.currentSize === oldStartSize) {
            this.data.currentSize = this.data.startSize;
        }

        this.data.aiProvider = aiProvider;
        this.data.geminiApiKey = apiKey.trim();
        this.data.minimaxApiKey = minimaxKey.trim();
        this.data.geminiModelName = modelName.trim() || 'gemini-1.5-flash';
        this.data.dailyGoalHours = parseFloat(dailyGoal) || 6;
        
        this.data.firebaseApiKey = fbKey.trim() || 'AIzaSyBGrnSSeLSY_XvnhxZRjH8kk5uRb-JHdwk';
        this.data.firebaseDbUrl = fbUrl.trim() || 'https://utakip-sync-default-rtdb.europe-west1.firebasedatabase.app';
        this.data.firebaseAuthDomain = (fbAuth || '').trim() || 'utakip-sync.firebaseapp.com';
        this.data.firebaseSyncId = fbId.trim();
        this.data.cloudSyncEnabled = !!fbEnabled;

        this.data.workCycleDays = parseInt(workCycle) || 5;
        this.data.restCycleDays = parseInt(restCycle) || 2;

        if(target && !isNaN(parseFloat(target))) {
            this.data.targetSize = parseFloat(target);
        }
        if(growthRate && !isNaN(parseFloat(growthRate))) {
            this.data.targetMonthlyGrowth = parseFloat(growthRate);
        }
        this.save();
    }

    toggleRestDay(dateStr) {
        if (!this.data.restDays) this.data.restDays = {};
        this.data.restDays[dateStr] = !this.data.restDays[dateStr];
        // Eğer o gün seans varsa ve dinlenme olarak işaretlenirse seansları silme kararı kullanıcıya bırakılabilir 
        // ancak şu anki mantıkta hem seans hem dinlenme teknik olarak olabilir (ama renklendirmede dinlenme öncelikli olabilir).
        this.save();
        return this.data.restDays[dateStr];
    }

    toggleDailyPump(dateStr, type = 'warmup') {
        if (!this.data.dailyPump) this.data.dailyPump = {};
        let entry = this.data.dailyPump[dateStr];
        
        // Migration & Initialization
        if (!entry || typeof entry !== 'object') {
            let w = false;
            let b = false;
            if (entry === true || entry === 1) w = true;
            if (entry === 2) b = true;
            if (entry === 3) { w = true; b = true; }
            entry = { warmup: w, bloodflow: b };
        }
        
        entry[type] = !entry[type];
        this.data.dailyPump[dateStr] = entry;
        this.save();
        return entry[type];
    }

    setCurrentData(size, tension) {
        let saveNeeded = false;
        const today = new Date();
        const currentYYYYMM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        
        if(size) {
            const sizeNum = parseFloat(String(size).replace(',', '.'));
            if (!isNaN(sizeNum)) {
                this.data.currentSize = sizeNum;
                if (!this.data.monthlySize) this.data.monthlySize = {};
                this.data.monthlySize[currentYYYYMM] = sizeNum;
                saveNeeded = true;
            }
        }
        if(tension) {
            const tensionNum = parseFloat(String(tension).replace(',', '.'));
            if (!isNaN(tensionNum)) {
                if (!this.data.monthlyTension) this.data.monthlyTension = {};
                this.data.monthlyTension[currentYYYYMM] = tensionNum;
                saveNeeded = true;
            }
        }
        if(saveNeeded) this.save();
    }

    addSession(dateStr, minutes, diff = 'normal', note = '') {
        if (!this.data.sessions[dateStr]) {
            this.data.sessions[dateStr] = [];
        }
        if (this.data.sessions[dateStr].length >= 5) {
            alert('Günlük maksimum 5 seans girebilirsiniz.');
            return false;
        }
        this.data.sessions[dateStr].push({ mins: parseInt(minutes), diff: diff });
        if (note) {
            this.addJournalNote(dateStr, { note: note });
        }
        this.save();
        return true;
    }

    getConsecutiveWorkDays(dateStr) {
        let count = 0;
        let d = new Date(dateStr);
        // Geriye doğru 30 gün kontrol et (yeterli bir sınır)
        // Check starting from YESTERDAY to see current consecutive count before today
        for (let i = 1; i < 30; i++) {
            const checkDate = new Date(d);
            checkDate.setDate(d.getDate() - i);
            const k = checkDate.toISOString().split('T')[0];
            const sessions = this.data.sessions[k] || [];
            if (sessions.length > 0) {
                count++;
            } else {
                break;
            }
        }
        return count;
    }

    addJournalNote(dateStr, noteObj) {
        if (!this.data.notes) this.data.notes = {};
        if (!this.data.notes[dateStr]) this.data.notes[dateStr] = [];
        
        const structuredNote = typeof noteObj === 'string' ? { note: noteObj } : noteObj;
        
        this.data.notes[dateStr].push({
            timestamp: Date.now(),
            ...structuredNote
        });
        this.save();
    }

    getDailyNote(dateStr) {
        if (!this.data.notes || !this.data.notes[dateStr]) return null;
        const notes = this.data.notes[dateStr];
        // En güncel (son) not objesini veya string'i döndür
        const lastEntry = notes[notes.length - 1];
        return typeof lastEntry === 'string' ? { note: lastEntry } : lastEntry;
    }

    saveDailyNote(dateStr, noteData) {
        if (!this.data.notes) this.data.notes = {};
        if (!this.data.notes[dateStr]) this.data.notes[dateStr] = [];
        
        // Eğer o gün hiç not yoksa yeni ekle, varsa sonuncuyu GÜNCELLE (Düzenleme mantığı)
        if (this.data.notes[dateStr].length === 0) {
            this.data.notes[dateStr].push({
                timestamp: Date.now(),
                ...noteData
            });
        } else {
            const lastIdx = this.data.notes[dateStr].length - 1;
            this.data.notes[dateStr][lastIdx] = {
                ...this.data.notes[dateStr][lastIdx],
                ...noteData,
                timestamp: Date.now() // Güncellendiği zamanı tut
            };
        }
        this.save();
    }
    
    // Getters
    getMonthlyGrowth(yearMonth) {
        if (!this.data.monthlySize || !this.data.monthlySize[yearMonth]) return 0;
        const sizes = { "0000-00": this.data.startSize }; 
        Object.keys(this.data.monthlySize).forEach(k => sizes[k] = this.data.monthlySize[k]);
        const sortedKeys = Object.keys(sizes).sort();
        const currentIndex = sortedKeys.indexOf(yearMonth);
        if (currentIndex <= 0) return 0;
        const prevKey = sortedKeys[currentIndex - 1];
        return (sizes[yearMonth] - sizes[prevKey]) * 10;
    }

    getTodayMinutes() {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const sessions = this.data.sessions[dateStr] || [];
        return sessions.reduce((acc, s) => acc + s.mins, 0);
    }

    getTotalGrowth() {
        const start = parseFloat(this.data.startSize);
        const current = parseFloat(this.data.currentSize);
        if (isNaN(start) || isNaN(current) || start === 0) return 0;
        return (current - start) * 10;
    }
    
    getStage() {
        let growth = this.getTotalGrowth();
        growth = parseFloat(growth.toFixed(1)); 
        if (growth < 0) return 1;
        return Math.floor(growth / 10) + 1;
    }

    getStageProgress() {
        let growth = this.getTotalGrowth();
        growth = parseFloat(growth.toFixed(1)); 
        if (growth < 0) return 0;
        return growth % 10;
    }

    getTotalMinutes() {
        let total = 0;
        if (!this.data.sessions) return 0;
        Object.values(this.data.sessions).forEach(daySessions => {
            daySessions.forEach(s => { total += (s.mins || 0); });
        });
        return total;
    }
}

// --- NOTIFICATION HELPERS ---
function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.6);
    } catch (e) { console.warn("Audio play failed:", e); }
}

function sendLocalNotification(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        const options = { body: body, icon: 'icon.png', vibrate: [200, 100, 200], badge: 'icon.png', requireInteraction: true };
        if (navigator.serviceWorker) {
            navigator.serviceWorker.ready.then(reg => { 
                if (reg && reg.showNotification) {
                    reg.showNotification(title, options); 
                } else {
                    new Notification(title, options);
                }
            });
        } else { 
            new Notification(title, options); 
        }
    }
}

function vibrateDevice() {
    if ("vibrate" in navigator) { navigator.vibrate([300, 100, 300]); }
}

// App Initialization and DOM interactions
let dataManager;

document.addEventListener('DOMContentLoaded', () => {
    // Fonksiyonları global kapsamda erişilebilir kıl (v2.4.3 Fix)
    window.updateHomeView = updateHomeView;
    window.updateCalendarView = updateCalendarView;
    window.updateTimerDisplay = updateTimerDisplay;
    window.updateSettingsView = updateSettingsView;
    window.updateJournalView = updateJournalView;
    window.updateCoachSectionView = updateCoachSectionView;

    dataManager = new TrackerData();
    initCloudSync();

    // --- AUTH UI LOGIC (v2.5.0) ---
    let authMode = 'login';
    const btnToggleAuth = document.getElementById('btnToggleAuthMode');
    const btnAuthAction = document.getElementById('btnAuthAction');

    if (btnToggleAuth) {
        btnToggleAuth.addEventListener('click', () => {
            authMode = authMode === 'login' ? 'register' : 'login';
            document.getElementById('authTitle').textContent = authMode === 'login' ? 'Hoş Geldiniz' : 'Hesap Oluştur';
            document.getElementById('authSubtitle').textContent = authMode === 'login' ? 'Gelişiminizi bulut ile senkronize edin.' : 'Verileriniz her zaman güvende kalır.';
            btnAuthAction.textContent = authMode === 'login' ? 'GİRİŞ YAP' : 'KAYIT OL';
            document.getElementById('authFooterText').textContent = authMode === 'login' ? 'Hesabınız yok mu?' : 'Zaten hesabınız var mı?';
            btnToggleAuth.textContent = authMode === 'login' ? 'Kayıt Ol' : 'Giriş Yap';
            

        });
    }

    if (btnAuthAction) {
        btnAuthAction.addEventListener('click', async () => {
            const email = document.getElementById('authEmail').value.trim();
            const password = document.getElementById('authPassword').value;
            const errorEl = document.getElementById('authError');
            if (errorEl) errorEl.textContent = "";

            if (!email || !password) {
                if (errorEl) errorEl.textContent = "Lütfen e-posta ve şifre girin.";
                return;
            }

            btnAuthAction.disabled = true;
            const originalText = btnAuthAction.textContent;
            btnAuthAction.textContent = "İşleniyor...";

            try {
                if (authMode === 'login') {
                    await firebase.auth().signInWithEmailAndPassword(email, password);
                } else {
                    await firebase.auth().createUserWithEmailAndPassword(email, password);
                    showSuccessAchievement("Kayıt Başarılı", "Hesabınız oluşturuldu.", "✨");
                }
            } catch (e) {
                console.error("Auth Error:", e);
                if (errorEl) errorEl.textContent = e.message;
            } finally {
                btnAuthAction.disabled = false;
                btnAuthAction.textContent = originalText;
            }
        });
    }



    // --- AUTOMATED UPDATE LOGIC (v2.5.8 Fix) ---
    function checkSystemUpdate() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
                // UI Güncelleme Fonksiyonu
                const showUpdateAvailable = (waitingWorker) => {
                    const icon = document.getElementById('updateStatusIcon');
                    const text = document.getElementById('updateStatusText');
                    const box = document.getElementById('changelogBox');
                    const btn = document.getElementById('btnUpdateApp');
                    
                    if (icon) { icon.textContent = 'system_update'; icon.style.color = '#ffca28'; }
                    if (text) { text.textContent = 'Yeni Güncelleme Hazır!'; text.style.color = '#ffca28'; }
                    if (box) box.style.display = 'block';
                    if (btn) {
                        btn.style.display = 'block';
                        btn.onclick = () => {
                            btn.textContent = '⏳ Yükleniyor...';
                            btn.disabled = true;
                            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
                        };
                    }
                };

                // Zaten bekleyen bir SW varsa
                if (reg.waiting) {
                    showUpdateAvailable(reg.waiting);
                }

                // Yeni SW yükleniyorsa dinle
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateAvailable(newWorker);
                        }
                    });
                });

                // Arka planda sunucuya yeni sürüm var mı diye sor
                reg.update().catch(e => console.log("Background SW update check failed:", e));
            });
        }
    }
    
    // Uygulama açılışında arka plan denetimi yap
    checkSystemUpdate();

    // Hide Splash Screen with delay
    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash) {
            splash.classList.add('hidden');
            setTimeout(() => splash.remove(), 1000); // Fully remove after transition
        }
    }, 1200);

    // Tab Navigation Switcher
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            switchView(target);
        });
    });

    // Failsafe: Eğer bir hata nedeniyle splashScreen 4 saniye içinde kapanmazsa zorla kapat (v1.9.1)
    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash && !splash.classList.contains('hidden')) {
            console.warn("Failsafe: Splash screen forced to close.");
            splash.classList.add('hidden');
            setTimeout(() => splash.remove(), 1000);
        }
    }, 4000);

    function saveSettingsUI() {
        const nameEl = document.getElementById('userName');
        if (!nameEl) return;

        const name = nameEl.value;
        const age = document.getElementById('userAge').value;
        const date = document.getElementById('startDate').value;
        const size = document.getElementById('startSize').value;
        const target = document.getElementById('targetSize').value;
        const growth = document.getElementById('targetMonthlyGrowth').value;
        const aiProvider = document.getElementById('aiProvider').value;
        const apiKey = document.getElementById('geminiApiKey').value;
        const minimaxKey = document.getElementById('minimaxApiKey').value;
        const modelName = document.getElementById('geminiModelName').value;
        const dailyGoal = document.getElementById('dailyGoalHours').value;
        
        const fbKey = dataManager.data.firebaseApiKey;
        const fbUrl = dataManager.data.firebaseDbUrl;
        const fbAuth = dataManager.data.firebaseAuthDomain;
        const fbId = dataManager.data.firebaseSyncId;
        const fbEnabled = dataManager.data.cloudSyncEnabled;

        const workCycle = document.getElementById('workCycleDays').value;
        const restCycle = document.getElementById('restCycleDays').value;

        // Save Base Settings
        dataManager.setBaseSettings(name, age, date, size, target, growth, apiKey, modelName, dailyGoal, aiProvider, minimaxKey, fbKey, fbUrl, fbId, fbEnabled, workCycle, restCycle, fbAuth);
        
        // Timer Settings
        const tCount = document.getElementById('timerCount').value;
        const tDur = document.getElementById('timerDuration').value;
        const tBreak = document.getElementById('timerBreak').value;
        const tSound = document.getElementById('notifSound').checked;
        const tVib = document.getElementById('notifVibrate').checked;
        dataManager.setTimerSettings(tCount, tDur, tBreak, tSound, tVib);
    }

    function switchView(target) {
        // Auto-save settings before leaving settings view (v2.1.7)
        const settingsView = document.getElementById('settings');
        if (settingsView && settingsView.classList.contains('active') && target !== 'settings') {
            saveSettingsUI();
        }

        navBtns.forEach(b => b.classList.remove('active'));
        views.forEach(v => v.classList.remove('active'));

        const targetBtn = document.querySelector(`.nav-btn[data-target="${target}"]`);
        if (targetBtn) targetBtn.classList.add('active');
        
        const targetView = document.getElementById(target);
        if (targetView) targetView.classList.add('active');
        
        // Refresh data when switching
        if(target === 'home') updateHomeView();
        if(target === 'calendar') updateCalendarView();
        if(target === 'journal') updateJournalView();
        if(target === 'coach') updateCoachSectionView();
        if(target === 'settings') updateSettingsView();
    }

    // Home Page Journal Button
    document.getElementById('btnHomeOpenJournal')?.addEventListener('click', () => {
        switchView('journal');
    });

    // --- EMERGENCY AUTH SETUP (v2.5.2) ---
    document.getElementById('authSettingsTrigger')?.addEventListener('click', () => {
        const panel = document.getElementById('authSettingsPanel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        
        // Mevcut verileri doldur
        document.getElementById('authSetupKey').value = dataManager.data.firebaseApiKey || '';
        document.getElementById('authSetupDomain').value = dataManager.data.firebaseAuthDomain || '';
        document.getElementById('authSetupUrl').value = dataManager.data.firebaseDbUrl || '';
    });

    document.getElementById('btnSaveAuthSetup')?.addEventListener('click', () => {
        const key = document.getElementById('authSetupKey').value.trim();
        const domain = document.getElementById('authSetupDomain').value.trim();
        const url = document.getElementById('authSetupUrl').value.trim();
        
        if (!key || !domain || !url) {
            alert("Lütfen tüm alanları doldurun.");
            return;
        }

        dataManager.data.firebaseApiKey = key;
        dataManager.data.firebaseAuthDomain = domain;
        dataManager.data.firebaseDbUrl = url;
        dataManager.data.cloudSyncEnabled = true;
        dataManager.save();
        
        alert("Ayarlar kaydedildi. Uygulama yenileniyor...");
        window.location.reload();
    });

    // Logout Button (v2.5.0)
    const handleSignOut = async () => {
        if (confirm("Oturumu kapatmak istediğinize emin misiniz?")) {
            try {
                if (firebase.apps.length > 0) {
                    await firebase.auth().signOut();
                }
            } catch (e) {
                console.warn("Firebase SignOut error (skipping):", e);
            }
            // Her durumda (hata olsa bile) yerel veriyi sil ve sayfayı yenile
            localStorage.removeItem('uTakipData');
            window.location.reload();
        }
    };

    document.getElementById('btnQuickSignOut')?.addEventListener('click', handleSignOut);

    // Journal Back Button
    document.getElementById('btnJournalBack')?.addEventListener('click', () => {
        switchView('home');
    });

    // Settings Locks (Prevent Accidental Touches)
    function initSettingsLocks() {
        const sections = document.querySelectorAll('.settings-section');
        sections.forEach(section => {
            const h3 = section.querySelector('h3');
            if (!h3) return;
            
            section.classList.add('is-locked');
            
            const lockBtn = document.createElement('button');
            lockBtn.className = 'btn-lock-toggle';
            lockBtn.title = 'Ayarları Düzenle / Kilitle';
            lockBtn.innerHTML = '<span class="material-symbols-outlined icon-lock">lock</span>';
            
            lockBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                section.classList.toggle('is-locked');
                const isLocked = section.classList.contains('is-locked');
                lockBtn.querySelector('.icon-lock').textContent = isLocked ? 'lock' : 'lock_open';
                
                // Kilit kapandığında verileri kaydet (Kullanıcı talebi: Güncelle ve kapat)
                if (isLocked && typeof saveSettingsNow === 'function') {
                    saveSettingsNow();
                    // Başarı animasyonu gösterilebilir
                    showSuccessAchievement("Ayarlar Kaydedildi", "Bilgileriniz buluta senkronize edildi.", "🔒");
                }
            });
            
            h3.appendChild(lockBtn);
        });
    }
    initSettingsLocks();
    
    // Streak Click Toggle (v2.4.1)
    document.getElementById('displayStreakInfo')?.addEventListener('click', () => {
        window.streakDisplayMode = (window.streakDisplayMode === 'remaining') ? 'passed' : 'remaining';
        // Haptic feedback if available
        if ("vibrate" in navigator) navigator.vibrate(5);
        updateHomeView();
    });


    // --- SETUP: UI Generics ---
    
    function renderRulerScale(startCm = 0, targetCm = 0) {
        const topScale = document.getElementById('topScale');
        const bottomScale = document.getElementById('bottomScale');
        topScale.innerHTML = '';
        bottomScale.innerHTML = '';
        
        // Toplam mm uzunluğu: Başta 5mm + (Hedef - Başlangıç) * 10 + Sonda 5mm
        // Hedef yoksa varsayılan 50mm + 10mm (baş/son tampon)
        let diffMm = targetCm > startCm ? Math.round((targetCm - startCm) * 10) : 50;
        let totalMm = diffMm + 10; 
        
        if (totalMm < 30) totalMm = 35; // Çok kısa kalmaması için
        
        // Ekranda her 10 mm tam 1 ekran genişliği (100% width) kaplıyorsa => width = ((totalMm / 10) * 100)%
        document.getElementById('rulerContainer').style.width = `${(totalMm / 10) * 100}%`;
        
        for(let i=0; i<=totalMm; i++) {
            const isMajor = (i % 5 === 0);
            const isCm = (i % 10 === 0);
            
            const tTick = document.createElement('div');
            tTick.className = `tick-number-pos ${isMajor ? 'major' : ''}`;
            
            // i=5 noktası gerçek başlangıç CM (startCm) değeridir.
            // Bu yüzden val ofsetli hesaplanır:
            let mmRelative = i - 5;
            let currentValCm = startCm + (mmRelative / 10);

            if (isMajor) {
                let displayVal = currentValCm % 1 === 0 ? currentValCm : currentValCm.toFixed(1);
                const numberEl = document.createElement('div');
                numberEl.className = 'ruler-floating-number';
                numberEl.textContent = displayVal + ' cm';
                tTick.appendChild(numberEl);
                
                tTick.style.cursor = 'pointer';
                const closureVal = currentValCm;
                tTick.onclick = () => { if (window.showPointEstimate) window.showPointEstimate(closureVal); };
            }
            
            // Başlangıç Bayrağı (🚩) - i=5 tam startCm konumudur
            if (i === 5) {
                const flag = document.createElement('div');
                flag.textContent = '🚩';
                flag.className = 'ruler-target-flag';
                flag.style.color = '#ff6b6b';
                tTick.appendChild(flag);
            }

            // Final Bayrağı (🏁) - i = totalMm - 5 tam targetCm konumudur
            const targetIndex = totalMm - 5;
            if (i === targetIndex && targetCm > startCm) {
                const flag = document.createElement('div');
                flag.textContent = '🏁';
                flag.className = 'ruler-target-flag';
                tTick.appendChild(flag);
            }
            
            topScale.appendChild(tTick);
            
            const bTick = document.createElement('div');
            bTick.className = `ruler-dot ${isMajor ? 'major' : ''}`;
            
            if (isMajor) {
                bTick.style.cursor = 'pointer';
                const closureVal = currentValCm;
                bTick.onclick = () => { if (window.showPointEstimate) window.showPointEstimate(closureVal); };
            }
            
            bottomScale.appendChild(bTick);
        }
        
        return totalMm;
    }

    // --- LOGIC: Views ---


    function renderRulerScale(startCm = 0, targetCm = 0) {
        const topScale = document.getElementById('topScale');
        const bottomScale = document.getElementById('bottomScale');
        topScale.innerHTML = '';
        bottomScale.innerHTML = '';
        
        // Mevcut boyu da hesaba kat (v2.2.1) - Eğer hedef aşılmışsa cetvel uzamaya devam etmeli
        const currentSize = parseFloat(dataManager.data.currentSize) || startCm;
        const maxReached = Math.max(targetCm, currentSize + 1.0); 
        
        let diffMm = maxReached > startCm ? Math.round((maxReached - startCm) * 10) : 50;
        let totalMm = diffMm + 10; 
        
        if (totalMm < 30) totalMm = 35; 
        
        document.getElementById('rulerContainer').style.width = `${(totalMm / 10) * 100}%`;
        
        for(let i=0; i<=totalMm; i++) {
            const isMajor = (i % 5 === 0);
            let mmRelative = i - 5;
            let currentValCm = startCm + (mmRelative / 10);

            const tTick = document.createElement('div');
            tTick.className = `tick-number-pos ${isMajor ? 'major' : ''}`;
            
            if (isMajor) {
                let displayVal = currentValCm % 1 === 0 ? currentValCm : currentValCm.toFixed(1);
                const numberEl = document.createElement('div');
                numberEl.className = 'ruler-floating-number';
                numberEl.textContent = displayVal + ' cm';
                tTick.appendChild(numberEl);
                tTick.style.cursor = 'pointer';
                tTick.onclick = () => { if (window.showPointEstimate) window.showPointEstimate(currentValCm); };
            }
            
            if (i === 5) {
                const flag = document.createElement('div');
                flag.textContent = '🚩';
                flag.className = 'ruler-target-flag';
                flag.style.color = '#ff6b6b';
                tTick.appendChild(flag);
            }

            const targetIndex = totalMm - 5;
            if (i === targetIndex && targetCm > startCm) {
                const flag = document.createElement('div');
                flag.textContent = '🏁';
                flag.className = 'ruler-target-flag';
                tTick.appendChild(flag);
            }
            
            topScale.appendChild(tTick);
            
            const bTick = document.createElement('div');
            bTick.className = `ruler-dot ${isMajor ? 'major' : ''}`;
            if (isMajor) {
                bTick.style.cursor = 'pointer';
                bTick.onclick = () => { if (window.showPointEstimate) window.showPointEstimate(currentValCm); };
            }
            bottomScale.appendChild(bTick);
        }
        return totalMm;
    }

    function updateHomeView() {
        const displayDate = document.getElementById('displayStartDate');
        if (dataManager.data.startDate) {
            const d = new Date(dataManager.data.startDate);
            displayDate.textContent = d.toLocaleDateString('tr-TR');
        } else {
            displayDate.textContent = 'Ayarlanmadı';
        }

        // --- STREAK / DAY CALCULATION (v2.4.1) ---
        const displayStreakInfo = document.getElementById('displayStreakInfo');
        const displayStreakValue = document.getElementById('displayStreakValue');
        const displayStreakSub = document.getElementById('displayStreakSub');
        
        if (displayStreakInfo && displayStreakValue && displayStreakSub) {
            if (dataManager.data.startDate) {
                displayStreakInfo.style.display = 'flex';
                
                const start = new Date(dataManager.data.startDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                start.setHours(0, 0, 0, 0);
                
                // Gün farkı (Geçen gün)
                const diffTime = today - start;
                const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
                
                if (!window.streakDisplayMode) window.streakDisplayMode = 'remaining';
                
                if (window.streakDisplayMode === 'passed') {
                    displayStreakValue.textContent = diffDays;
                    displayStreakSub.textContent = 'Geçen Gün';
                } else {
                    // Hedefe kalan gün hesabı
                    let rate = dataManager.data.targetMonthlyGrowth > 0 ? dataManager.data.targetMonthlyGrowth : 2;
                    let baseSize = dataManager.data.currentSize > 0 ? dataManager.data.currentSize : dataManager.data.startSize;
                    let remainingCm = dataManager.data.targetSize - baseSize;
                    
                    if (remainingCm <= 0 || !dataManager.data.targetSize) {
                        displayStreakValue.textContent = '0';
                        displayStreakSub.textContent = 'Kalan Gün';
                    } else {
                        // mm cinsinden kalan / (aylık mm / 30.43 gün) = toplam gün
                        let totalDaysRemaining = Math.ceil((remainingCm * 10) / (rate / 30.4375));
                        displayStreakValue.textContent = totalDaysRemaining;
                        displayStreakSub.textContent = 'Kalan Gün';
                    }
                }
            } else {
                displayStreakInfo.style.display = 'none';
            }
        }

        const estFinal = document.getElementById('estFinal');
        if (estFinal) {
            if (dataManager.data.targetSize && dataManager.data.targetSize > 0) {
                estFinal.style.display = 'block';
                const targetSizeEl = document.getElementById('displayTargetSize');
                if (targetSizeEl) targetSizeEl.textContent = dataManager.data.targetSize.toFixed(1);
                
                let rate = dataManager.data.targetMonthlyGrowth > 0 ? dataManager.data.targetMonthlyGrowth : 2;
                let baseSize = dataManager.data.currentSize > 0 ? dataManager.data.currentSize : dataManager.data.startSize;
                let remainingCm = dataManager.data.targetSize - baseSize;
                const estEl = document.getElementById('displayEstimate');
                if (estEl) {
                    if (remainingCm <= 0) {
                        estEl.textContent = 'Hedefe Ulaşıldı!';
                    } else {
                        let monthsNeeded = Math.ceil((remainingCm * 10) / rate); 
                        const estDate = new Date();
                        estDate.setMonth(estDate.getMonth() + monthsNeeded);
                        estEl.textContent = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(estDate);
                    }
                }
            } else {
                estFinal.style.display = 'none';
            }
        }

        const coachMsgEl = document.getElementById('coachMessage');
        coachMsgEl.innerHTML = generateCoachAdvice();
        
        const startCm = dataManager.data.startSize;
        const targetCm = dataManager.data.targetSize > 0 ? dataManager.data.targetSize : startCm + 5;
        const totalMm = renderRulerScale(startCm, targetCm);

        const estMidEl = document.getElementById('estMid');
        const estEndEl = document.getElementById('estEnd');
        if (!window.rulerTimer) window.rulerTimer = null;
        const dateOpts = { day: '2-digit', month: 'long', year: 'numeric' };

        function updateDefaultEstimates() {
            const rawRate = dataManager.data.targetMonthlyGrowth || 2;
            const currentSize = parseFloat(dataManager.data.currentSize) || parseFloat(dataManager.data.startSize);
            let next1Cm = (Math.floor(currentSize * 2) + 1) / 2;
            let next2Cm = next1Cm + 0.5;
            const mmDiff1 = Math.max(0, (next1Cm - currentSize) * 10);
            const daysNeeded1 = (mmDiff1 / rawRate) * 30.4375;
            const date1 = new Date();
            date1.setDate(date1.getDate() + daysNeeded1);
            const mmDiff2 = Math.max(0, (next2Cm - currentSize) * 10);
            const daysNeeded2 = (mmDiff2 / rawRate) * 30.4375;
            const date2 = new Date();
            date2.setDate(date2.getDate() + daysNeeded2);
            estMidEl.innerHTML = `🎯 Sıradaki Hedef (<b>${next1Cm.toFixed(1)} cm</b>): ${date1.toLocaleDateString('tr-TR', dateOpts)}`;
            estEndEl.innerHTML = `🏆 Sonraki Hedef (<b>${next2Cm.toFixed(1)} cm</b>): ${date2.toLocaleDateString('tr-TR', dateOpts)}`;
        }

        window.showPointEstimate = (targetCmValue) => {
            if (window.rulerTimer) clearTimeout(window.rulerTimer);
            const currentSize = parseFloat(dataManager.data.currentSize) || parseFloat(dataManager.data.startSize);
            const rate = dataManager.data.targetMonthlyGrowth || 2;
            const mmDiff = Math.max(0, (targetCmValue - currentSize) * 10);
            const targetDate = new Date();
            const daysNeeded = (mmDiff / rate) * 30.4375;
            targetDate.setDate(targetDate.getDate() + daysNeeded);
            estMidEl.innerHTML = `🔎 <b>${targetCmValue.toFixed(1)} cm</b> Sorgusu: ${targetDate.toLocaleDateString('tr-TR', dateOpts)}`;
            estEndEl.innerHTML = `<span style="opacity: 0.5;">(Tahmini varış süresidir)</span>`;
            window.rulerTimer = setTimeout(() => { updateDefaultEstimates(); }, 3500);
        };

        if (!window.rulerTimer) updateDefaultEstimates();

        const currentSizeNum = parseFloat(dataManager.data.currentSize) || parseFloat(startCm);
        const scaleStartCm = startCm - 0.5;
        let growthMmRelativeToScale = (currentSizeNum - scaleStartCm) * 10;
        if(growthMmRelativeToScale < 0) growthMmRelativeToScale = 0;
        if(growthMmRelativeToScale > totalMm) growthMmRelativeToScale = totalMm;
        const widthPercent = (growthMmRelativeToScale / totalMm) * 100;
        
        setTimeout(() => {
            const fill = document.getElementById('rulerFill');
            if(fill) fill.style.width = `${widthPercent}%`;
            const viewport = document.getElementById('rulerViewport');
            if (viewport) {
                const diffCm = currentSizeNum - startCm;
                const vitesIndex = Math.floor(diffCm / 0.5);
                let scrollMm = (Math.max(0, vitesIndex) * 5) + 4;
                const scrollWidth = viewport.scrollWidth;
                const pxPerMm = scrollWidth / totalMm;
                viewport.scrollTo({ left: scrollMm * pxPerMm, behavior: 'smooth' });
            }
        }, 150);

        const dailyMins = dataManager.getTodayMinutes();
        const goalHours = dataManager.data.dailyGoalHours || 6;
        const goalMins = goalHours * 60;
        const dailyPercent = Math.min((dailyMins / goalMins) * 100, 100); 
        const dailyFill = document.getElementById('dailyProgressFill');
        const dailyText = document.getElementById('dailyTimeText');
        if (dailyFill && dailyText) {
            const h = Math.floor(dailyMins / 60);
            const m = dailyMins % 60;
            dailyText.textContent = `${h}s ${m}dk`;
            let color = '#ffffff'; 
            if (dailyMins >= goalMins * 0.75) color = '#bb86fc';
            else if (dailyMins >= 240) color = '#2ecc71';
            else if (dailyMins >= 120) color = '#f39c12';
            setTimeout(() => {
                dailyFill.style.width = `${dailyPercent}%`;
                dailyFill.style.backgroundColor = color;
                dailyFill.style.boxShadow = `0 0 10px ${color}44`;
            }, 100);
            if (dailyMins >= goalMins && !dataManager.sessionAchievements.daily) {
                showSuccessAchievement("Günlük Hedef", "Tebrikler, bugünkü çalışma seansını başarıyla tamamladın!", "🔥");
                dataManager.sessionAchievements.daily = true;
            }
        }
        updateChartView();
    }
    
    // --- CETVEL SURUKLEME (DRAG TO SCROLL) MOUSE DESTEGI ---
    const rulerViewport = document.getElementById('rulerViewport');
    if (rulerViewport) {
        let isDown = false;
        let startX;
        let scrollLeft;

        rulerViewport.addEventListener('mousedown', (e) => {
            isDown = true;
            rulerViewport.classList.add('grabbing');
            startX = e.pageX - rulerViewport.offsetLeft;
            scrollLeft = rulerViewport.scrollLeft;
        });

        rulerViewport.addEventListener('mouseleave', () => {
            isDown = false;
            rulerViewport.classList.remove('grabbing');
        });

        rulerViewport.addEventListener('mouseup', () => {
            isDown = false;
            rulerViewport.classList.remove('grabbing');
        });

        rulerViewport.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - rulerViewport.offsetLeft;
            const walk = (x - startX) * 2; // Kaydırma hızı (2x)
            rulerViewport.scrollLeft = scrollLeft - walk;
        });
    }

    function updateJournalView() {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        document.getElementById('journalTodayDate').textContent = today.toLocaleDateString('tr-TR', options);

        const container = document.getElementById('journalContainer');
        container.innerHTML = '';

        // Get last 7 days of notes
        const allDates = Object.keys(dataManager.data.notes || {}).sort().reverse();
        const lastDates = allDates.slice(0, 10);

        if (lastDates.length === 0) {
            container.innerHTML = '<p style="text-align:center; opacity:0.5; font-size:13px; margin:20px;">Henüz bir günlük kaydı bulunmuyor.</p>';
        }

        lastDates.forEach(d => {
            const notes = dataManager.data.notes[d];
            notes.forEach(n => {
                const card = document.createElement('div');
                card.className = 'card journal-entry-card';
                
                const noteObj = typeof n === 'string' ? { note: n } : n;
                const dateObj = new Date(d);
                
                let tagsHtml = '';
                if (noteObj.pump) tagsHtml += '<span class="j-tag">🌀 Pompa</span>';
                if (noteObj.mast) tagsHtml += '<span class="j-tag">🔥 Mast</span>';
                if (noteObj.pain > 0) {
                    const levels = ["", "Hafif Hassasiyet", "Orta Derece Acı", "Şiddetli Acı"];
                    tagsHtml += `<span class="j-tag" style="background:rgba(218,54,51,0.1); color:#ff6b6b;">⚡ ${levels[noteObj.pain]}</span>`;
                }
                if (noteObj.screw) tagsHtml += `<span class="j-tag">🔧 Vida: ${noteObj.screw}</span>`;

                card.innerHTML = `
                    <div class="header">
                        <span>${dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</span>
                        <span style="opacity:0.5">${new Date(noteObj.timestamp || dateObj).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p style="font-size:14px; line-height:1.5;">${noteObj.note || 'Not girilmemiş.'}</p>
                    <div class="journal-tags">${tagsHtml}</div>
                `;
                container.appendChild(card);
            });
        });
    }

    // Pain Selector Logic
    let selectedPainLevel = 0;
    const painBtns = document.querySelectorAll('.btn-pain');
    painBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            painBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedPainLevel = parseInt(btn.getAttribute('data-val'));
        });
    });

    document.getElementById('btnSaveJournal')?.addEventListener('click', () => {
        const pump = document.getElementById('jPump').checked;
        const mast = document.getElementById('jMast').checked;
        const screw = document.getElementById('jScrew').value;
        const note = document.getElementById('jNote').value;
        
        const today = new Date();
        const offset = today.getTimezoneOffset() * 60000;
        const dateStr = (new Date(today - offset)).toISOString().split('T')[0];

        dataManager.addJournalNote(dateStr, {
            pump, mast, screw, note,
            pain: selectedPainLevel
        });

        showSuccessAchievement("Günlük Kaydedildi", "Bugünkü verilerin AI hafızasına eklendi.", "📝");
        
        // Reset
        document.getElementById('jPump').checked = false;
        document.getElementById('jMast').checked = false;
        document.getElementById('jScrew').value = '';
        document.getElementById('jNote').value = '';
        painBtns.forEach(b => b.classList.remove('active'));
        selectedPainLevel = 0;

        updateJournalView();
        updateHomeView();
        
        setTimeout(() => switchView('home'), 1000);
    });

    function formatMinutes(totalMins) {
        if (!totalMins) return '0 dk';
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        if (h > 0 && m > 0) return `${h} sa ${m} dk`;
        if (h > 0) return `${h} sa`;
        return `${m} dk`;
    }

    function updateCalendarView() {
        const container = document.getElementById('calendarAccordionContainer');
        if(!container) return; // safety
        container.innerHTML = '';

        const monthSet = new Set();
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const currentYYYYMM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        monthSet.add(currentYYYYMM);

        if (dataManager.data.sessions) {
            Object.keys(dataManager.data.sessions).forEach(dateStr => {
                if (dateStr && dateStr.length >= 7 && dateStr.includes('-')) {
                    monthSet.add(dateStr.substring(0, 7));
                }
            });
        }

        // Geçmiş ayları startDate'e göre ekle (v2.4.1)
        if (dataManager.data.startDate) {
            let start = new Date(dataManager.data.startDate);
            if (!isNaN(start.getTime())) {
                let end = new Date();
                let curr = new Date(start.getFullYear(), start.getMonth(), 1);
                while (curr <= end) {
                    monthSet.add(`${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`);
                    curr.setMonth(curr.getMonth() + 1);
                }
            }
        }
        
        // Manuel girilen ayları da ekle
        Object.keys(dataManager.data.monthlyWork || {}).forEach(m => { if(m.includes('-')) monthSet.add(m); });
        Object.keys(dataManager.data.monthlyTension || {}).forEach(m => { if(m.includes('-')) monthSet.add(m); });
        Object.keys(dataManager.data.monthlySize || {}).forEach(m => { if(m.includes('-')) monthSet.add(m); });

        const sortedMonths = Array.from(monthSet).sort((a, b) => b.localeCompare(a));

        sortedMonths.forEach(yearMonth => {
            const monthParts = yearMonth.split('-');
            const y = parseInt(monthParts[0]);
            const m = parseInt(monthParts[1]) - 1;
            
            if (isNaN(y) || isNaN(m)) return; // Skip invalid formats (v2.4.2)

            const accordionItem = document.createElement('div');
            accordionItem.className = 'accordion-item';

            const headerCard = document.createElement('div');
            headerCard.className = 'card accordion-header';
            if (yearMonth === currentYYYYMM) headerCard.classList.add('open');
            
            let monthName = yearMonth;
            try {
                monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(y, m));
            } catch(e) { console.error("Date format error for:", yearMonth); }

            const h3 = document.createElement('h3');
            h3.textContent = `${monthName} Takvimi`;
            headerCard.appendChild(h3);

            const daysInMonth = new Date(y, m + 1, 0).getDate();
            let monthTotalMins = 0;
            const daysHTMLArray = [];

            for (let i = 1; i <= daysInMonth; i++) {
                const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                const sessions = dataManager.data.sessions[dateStr] || [];
                const isRestDay = dataManager.data.restDays && dataManager.data.restDays[dateStr];
                
                // Tüm günleri göster (Filtreleme kaldırıldı v2.3.0)
                if (true) {
                    let dailyTotalMins = 0;
                    
                    const dayRow = document.createElement('div');
                    dayRow.className = 'day-row';
                    
                    const dateCol = document.createElement('div');
                    dateCol.className = 'day-date day-label-group';
                    
                    const dayNumSpan = document.createElement('span');
                    dayNumSpan.className = 'day-number';
                    dayNumSpan.textContent = i;
                    
                    // DURUM RENKLENDİRMESİ (Sadece bugün ve geçmiş için)
                    if (dateStr <= todayStr) {
                        if (isRestDay) {
                            dayNumSpan.classList.add('status-rest');
                        } else if (sessions.length > 0) {
                            dayNumSpan.classList.add('status-active');
                        } else {
                            // Dinlenme değil ve seans yoksa...
                            // Önce akıllı öneri kontrolü (5 gün üst üste çalışma vs)
                            const consecutive = dataManager.getConsecutiveWorkDays(dateStr);
                            const workTarget = dataManager.data.workCycleDays || 5;
                            
                            if (consecutive >= workTarget) {
                                dayNumSpan.classList.add('status-suggested');
                            } else {
                                // Sadece geçmiş günler kırmızı olur, bugün (henüz dolmadıysa) normal kalabilir 
                                // ama kullanıcı "bugün renklendirilsin" dediği için bugün seans yoksa kırmızı olabilir (henüz yapılmadı).
                                // Ancak bugün hala vakit olduğu için bugünü kırmızı yapmak moral bozabilir.
                                // Karar: Bugün seans yoksa ve dinlenme değilse "normal" kalsın, geçmişse "kaçırılan" (red) olsun.
                                if (dateStr < todayStr) {
                                    dayNumSpan.classList.add('status-missed');
                                }
                            }
                        }
                    }

                    // Tıklama ile Dinlenme Günü Toggle
                    dayNumSpan.title = "Dinlenme Günü Olarak İşaretle / Kaldır";
                    dayNumSpan.onclick = (e) => {
                        e.stopPropagation();
                        dataManager.toggleRestDay(dateStr);
                        updateCalendarView();
                        updateHomeView();
                    };

                    dateCol.appendChild(dayNumSpan);

                    // Pompa Verilerini Hazırla
                    const pumpData = dataManager.data.dailyPump && dataManager.data.dailyPump[dateStr];
                    let isWarmup = false;
                    let isBloodflow = false;
                    if (typeof pumpData === 'object') {
                        isWarmup = !!pumpData.warmup;
                        isBloodflow = !!pumpData.bloodflow;
                    } else if (pumpData) {
                        // Migration fallback
                        if (pumpData === true || pumpData === 1 || pumpData === 3) isWarmup = true;
                        if (pumpData === 2 || pumpData === 3) isBloodflow = true;
                    }

                    // 1. Isınma Pompası (Mavi)
                    const warmupBtn = document.createElement('button');
                    warmupBtn.className = `btn-pump-toggle ${isWarmup ? 'state-warmup' : ''}`;
                    warmupBtn.title = 'Isınma Pompası (Başlangıç)';
                    warmupBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">mode_fan</span>';
                    warmupBtn.onclick = (e) => {
                        e.stopPropagation();
                        dataManager.toggleDailyPump(dateStr, 'warmup');
                        updateCalendarView();
                        updateHomeView();
                    };
                    dateCol.appendChild(warmupBtn);

                    // 2. Kan Akışı Pompası (Mor)
                    const bloodflowBtn = document.createElement('button');
                    bloodflowBtn.className = `btn-pump-toggle ${isBloodflow ? 'state-bloodflow' : ''}`;
                    bloodflowBtn.title = 'Kan Akışı Pompası (Seans Sonu)';
                    bloodflowBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">mode_fan</span>';
                    bloodflowBtn.onclick = (e) => {
                        e.stopPropagation();
                        dataManager.toggleDailyPump(dateStr, 'bloodflow');
                        updateCalendarView();
                        updateHomeView();
                    };
                    dateCol.appendChild(bloodflowBtn);

                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn-day-edit';
                    editBtn.title = 'Yeni Seans Ekle';
                    editBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        openEditModal(dateStr);
                    };
                    dateCol.appendChild(editBtn);

                    const noteBtn = document.createElement('button');
                    const hasNote = dataManager.data.notes && dataManager.data.notes[dateStr] && dataManager.data.notes[dateStr].length > 0;
                    noteBtn.className = `btn-note-toggle ${hasNote ? 'active' : ''}`;
                    noteBtn.title = 'Günlük Notları Düzenle';
                    noteBtn.innerHTML = '<span class="material-symbols-outlined">edit_note</span>';
                    noteBtn.onclick = (e) => {
                        e.stopPropagation();
                        openNoteModal(dateStr);
                    };
                    dateCol.appendChild(noteBtn);

                    dayRow.appendChild(dateCol);
                    
                    const sessionsCol = document.createElement('div');
                    sessionsCol.className = 'day-sessions';
                    
                    // Mouse Wheel ile Yatay Kaydırma Desteği (Desktop için)
                    sessionsCol.addEventListener('wheel', (e) => {
                        if (e.deltaY !== 0) {
                            e.preventDefault();
                            sessionsCol.scrollLeft += e.deltaY;
                        }
                    }, { passive: false });
                    
                    for(let s=0; s<5; s++) {
                        if (s < sessions.length) {
                            const sessionObj = sessions[s];
                            const mins = sessionObj.mins || 0;
                            dailyTotalMins += mins;
                            
                            const box = document.createElement('div');
                            box.className = 'session-box';
                            const diffColor = sessionObj.diff === 'rahat' ? '#3fb950' : (sessionObj.diff === 'zor' ? '#f85149' : '#f1c40f');
                            box.innerHTML = `
                                <div style="display:flex; align-items:center; justify-content:center; gap:4px; cursor:pointer;" title="Düzenle / Sil">
                                    <span style="font-weight:700;">${mins} dk</span>
                                    <span class="material-symbols-outlined" style="font-size:12px; color:${diffColor};">circle</span>
                                    <span class="material-symbols-outlined" style="font-size:12px; opacity:0.4;">edit</span>
                                </div>
                            `;
                            
                            box.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const newMinsStr = prompt(`${dateStr} tarihindeki seans süresini güncelle (Dakika):\n\nSilmek istersen 0 yazabilirsin.`, mins);
                                if (newMinsStr !== null) {
                                    const newMins = parseInt(newMinsStr);
                                    if (!isNaN(newMins) && newMins >= 0) {
                                        if (newMins === 0) {
                                            if (confirm("Bu seans kaydını tamamen silmek istediğinden emin misin?")) {
                                                dataManager.data.sessions[dateStr].splice(s, 1);
                                                if (dataManager.data.sessions[dateStr].length === 0) {
                                                    delete dataManager.data.sessions[dateStr];
                                                }
                                            } else {
                                                return;
                                            }
                                        } else {
                                            dataManager.data.sessions[dateStr][s].mins = newMins;
                                        }
                                        dataManager.save();
                                        updateCalendarView();
                                        updateHomeView();
                                    } else {
                                        alert("Lütfen geçerli bir dakika (sayı) girin.");
                                    }
                                }
                            });
                            sessionsCol.appendChild(box);
                        } else {
                            const empty = document.createElement('div');
                            empty.className = 'session-box session-empty';
                            empty.style.opacity = '0.3';
                            empty.style.borderStyle = 'dashed';
                            empty.style.background = 'transparent';
                            empty.textContent = '-';
                            sessionsCol.appendChild(empty);
                        }
                    }
                    
                    dayRow.appendChild(sessionsCol);
                    
                    const totalCol = document.createElement('div');
                    totalCol.className = 'day-total';
                    
                    // Renklendirme mantığı (v2.0.0) - Uzman önerisi: 4 saat (240 dk)
                    if (dailyTotalMins >= 360) { // 6 saat ve üstü
                        totalCol.classList.add('total-excellent');
                    } else if (dailyTotalMins >= 240) { // 4-6 saat arası
                        totalCol.classList.add('total-good');
                    } else { // 4 saat altı
                        totalCol.classList.add('total-low');
                    }
                    totalCol.title = 'Seansları Genişlet / Kapat';
                    totalCol.textContent = dailyTotalMins > 0 ? formatMinutes(dailyTotalMins) : '0 dk';
                    
                    // Seans Genişletme Özelliği (v1.9.5)
                    totalCol.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Diğer genişlemiş satırları kapat (opsiyonel ama daha temiz olur)
                        document.querySelectorAll('.day-row.is-expanded').forEach(row => {
                            if (row !== dayRow) row.classList.remove('is-expanded');
                        });
                        dayRow.classList.toggle('is-expanded');
                    });

                    dayRow.appendChild(totalCol);
                    
                    daysHTMLArray.push(dayRow);
                    monthTotalMins += dailyTotalMins;
                }
            }

            const statsDiv = document.createElement('div');
            statsDiv.className = 'summary-stats';
            const tension = dataManager.data.monthlyTension[yearMonth];
            const monthlySize = dataManager.data.monthlySize && dataManager.data.monthlySize[yearMonth];
            const monthlyGrowth = dataManager.getMonthlyGrowth(yearMonth);

            const statsHtml = `
                <div class="stat-box clickable" onclick="event.stopPropagation(); window.editMonthlyStat('work', '${yearMonth}')" title="Düzenlemek için tıkla">
                    <span class="stat-label">Aylık Çalışma</span>
                    <strong class="stat-value text-blue">${formatMinutes(monthTotalMins || dataManager.data.monthlyWork[yearMonth] || 0)}</strong>
                </div>
                <div class="stat-box clickable" onclick="event.stopPropagation(); window.editMonthlyStat('tension', '${yearMonth}')" title="Düzenlemek için tıkla">
                    <span class="stat-label">Aylık Vida Boyutu</span>
                    <strong class="stat-value" style="color: #d2a8ff;">${tension || '-'} mm</strong>
                </div>
                <div class="stat-box clickable" onclick="event.stopPropagation(); window.editMonthlyStat('growth', '${yearMonth}')" title="Düzenlemek için tıkla">
                    <span class="stat-label">Aylık Uzama</span>
                    <strong class="stat-value text-green">${monthlyGrowth.toFixed(1)} mm</strong>
                </div>
                <div class="stat-box clickable" onclick="event.stopPropagation(); window.editMonthlyStat('size', '${yearMonth}')" title="Düzenlemek için tıkla">
                    <span class="stat-label">Ay Sonu Boyutu</span>
                    <strong class="stat-value">${monthlySize ? monthlySize.toFixed(2) : '-'} cm</strong>
                </div>
            `;
            statsDiv.innerHTML = statsHtml;
            headerCard.appendChild(statsDiv);
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'accordion-body calendar-days';
            if (yearMonth === currentYYYYMM) bodyDiv.classList.add('open');
            
            daysHTMLArray.forEach(el => bodyDiv.appendChild(el));

            /* 
               Kullanıcı isteği üzerine 'Ayın Notları' arayüzden kaldırıldı. 
               Veriler arka planda AI kullanımı için saklanmaya devam ediyor.
            */

            headerCard.addEventListener('click', () => {
                headerCard.classList.toggle('open');
                bodyDiv.classList.toggle('open');
            });

            accordionItem.appendChild(headerCard);
            accordionItem.appendChild(bodyDiv);
            container.appendChild(accordionItem);
        });
    }

    // --- MANUEL STAT DÜZENLEME (TAKAVİM ÖZETİ) ---
    window.editMonthlyStat = function(type, yearMonth) {
        if (type === 'tension') {
            const current = dataManager.data.monthlyTension[yearMonth] || 10;
            const newVal = prompt(`${yearMonth} Ayı için Vida Boyutu (mm):`, current);
            if (newVal !== null) {
                dataManager.data.monthlyTension[yearMonth] = parseFloat(newVal);
                dataManager.save();
                updateCalendarView();
            }
        } else if (type === 'work') {
            const current = dataManager.data.monthlyWork[yearMonth] || 0;
            const h = Math.floor(current / 60);
            const m = current % 60;
            const newVal = prompt(`${yearMonth} Ayı için Toplam Çalışma Süresi (Dakika):\n(Örn: 5 saat için 300 yazın)`, current);
            if (newVal !== null) {
                const mins = parseInt(newVal);
                if (!isNaN(mins)) {
                    dataManager.data.monthlyWork[yearMonth] = mins;
                    dataManager.save();
                    updateCalendarView();
                    updateHomeView();
                }
            }
        } else if (type === 'size' || type === 'growth') {
            const currentSize = dataManager.data.monthlySize[yearMonth] || dataManager.data.startSize;
            const growth = dataManager.getMonthlyGrowth(yearMonth);
            
            const msg = type === 'size' 
                ? `${yearMonth} Ay Sonu Boyutu (cm):` 
                : `${yearMonth} Aylık Toplam Uzama (mm):`;
            const defaultVal = type === 'size' ? currentSize : growth;
            
            const newVal = prompt(msg, defaultVal);
            if (newVal !== null) {
                const val = parseFloat(newVal);
                if (type === 'size') {
                    dataManager.data.monthlySize[yearMonth] = val;
                } else {
                    const sizes = { "0000-00": dataManager.data.startSize }; 
                    Object.keys(dataManager.data.monthlySize).forEach(k => sizes[k] = dataManager.data.monthlySize[k]);
                    const sortedKeys = Object.keys(sizes).sort();
                    const currentIndex = sortedKeys.indexOf(yearMonth);
                    const prevKey = currentIndex > 0 ? sortedKeys[currentIndex - 1] : "0000-00";
                    const prevSize = sizes[prevKey];
                    dataManager.data.monthlySize[yearMonth] = prevSize + (val / 10);
                }
                
                const allMonths = Object.keys(dataManager.data.monthlySize).sort();
                if (allMonths[allMonths.length - 1] === yearMonth) {
                    dataManager.data.currentSize = dataManager.data.monthlySize[yearMonth];
                }

                dataManager.save();
                updateCalendarView();
                if (typeof updateHomeView === 'function') updateHomeView();
            }
        }
    };

    let growthChartInstance = null;
    function updateChartView() {
        const ctx = document.getElementById('growthChart').getContext('2d');
        const summaryText = document.getElementById('chartSummaryText');
        
        const startSize = dataManager.data.startSize || 0;
        const monthlyData = dataManager.data.monthlySize || {};
        
        let labels = ['Başlangıç'];
        let values = [startSize];
        
        const sortedMonths = Object.keys(monthlyData).sort();
        sortedMonths.forEach(m => {
            labels.push(m);
            values.push(monthlyData[m]);
        });
        
        if (sortedMonths.length === 0) {
            summaryText.textContent = "Henüz grafik oluşturmak için yeterli aylık veri (Ay Sonu Boyutu) bulunmuyor. Ayarlar sekmesinden 'Güncel Boyut'unuzu her ay kaydetmeyi unutmayın.";
            return;
        }

        const firstVal = values[0];
        const lastVal = values[values.length - 1];
        const totalGain = (lastVal - firstVal) * 10;
        summaryText.innerHTML = `Sürecine <strong>${firstVal} cm</strong> ile başladın. Şu anki güncel durumun <strong>${lastVal} cm</strong>. Toplamda <strong>${totalGain.toFixed(1)} mm</strong> gelişim kaydettin. ${totalGain > 0 ? 'Harika bir ivme yakalamışsın!' : 'Tutarlı kalarak grafiği yukarı taşımaya devam et.'}`;

        if (growthChartInstance) growthChartInstance.destroy();
        
        if (typeof Chart === 'undefined') {
            summaryText.textContent = "Grafik kütüphanesi yüklenemedi. Lütfen internet bağlantınızı kontrol edin.";
            return;
        }

        growthChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Boyut (cm)',
                    data: values,
                    borderColor: '#a5d6ff',
                    backgroundColor: 'rgba(165, 214, 255, 0.1)',
                    borderWidth: 3,
                    pointBackgroundColor: '#a5d6ff',
                    pointRadius: 5,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.6)' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.6)' }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    const coachKnowledgeBase = [
        {
            cat: "Kullanım Rehberi",
            q: "Extender Cihazı Nasıl Takılır?",
            a: "Cihazı takmadan önce penisin sünnet derisi geriye çekilmiş ve yumuşak (flaccid) durumda olduğundan emin olun. Silikon kementi veya kayışı baş (glans) kısmının hemen arkasındaki oluğa yerleştirin. İpi çok sıkıp kan akışını kesmeyin, ancak çıkmayacak kadar da sıkı olmalıdır. Yanlarda bulunan yaylı millerin eşit gergide olduğundan emin olun.",
            keys: ["nasıl takılır", "takılış", "kullanım", "yerleştirme"]
        },
        {
            cat: "Kullanım Rehberi",
            q: "Günde Kaç Saat Takılmalıdır?",
            a: "Büyüme için ideal süre günde toplam 4 ile 6 saattir. Ancak bu süreyi tek seferde değil, 2'şer saatlik 2 veya 3 seansa bölmek doku sağlığı için çok daha iyidir. Yeni başlıyorsanız ilk hafta günde 1-2 saat ile alışma süreci geçirin.",
            keys: ["kaç saat", "süre", "günlük", "zaman"]
        },
        {
            cat: "Bakım & Kremler",
            q: "Epitelizan Kremler Nedir? Hangileri Alınmalı?",
            a: "Epitelizan kremler doku yenileyici özelliğe sahiptir. Cihazı çıkardıktan sonra oluşabilecek mikroyırtıkları onarmak için 'Bepanthol' (Panthenol) veya 'Madecassol' (Centella Asiatica) gibi kremler kullanabilirsiniz. Bu kremler cildi nemlendirir, elastikiyetini artırır ve hücre bölünmesini destekler.",
            keys: ["krem", "bepanthol", "madecassol", "merhem", "bakım"]
        },
        {
            cat: "Bakım & Kremler",
            q: "Soğuma (Cool-down) Masajı Gerekli mi?",
            a: "Evet, seans bittikten sonra 1-2 dakika nazikçe dairesel masaj yapmak bölgedeki kan akışını tazeler. E vitamini yağı veya nemlendirici kremlerle yapılan bu masaj, bağ dokularının yeni boyutta kalıcılaşmasına yardımcı olur.",
            keys: ["masaj", "soğuma", "cooldown", "yağ"]
        },
        {
            cat: "Güvenlik & Uyarılar",
            q: "Ne Kadar Gerginlik (Tension) Olmalı?",
            a: "Asla acı verecek kadar çok germeyin! İdeal gerginlik, 'tatlı bir esneme' hissidir. Eğer zonklama, morarma veya uyuşma hissederseniz gerginliği hemen azaltın. Çok fazla germek büyümeyi hızlandırmaz, aksine dokuya zarar vererek süreci durdurur.",
            keys: ["gerginlik", "çekme", "acı", "uyuşma", "vidalama"]
        },
        {
            cat: "Güvenlik & Uyarılar",
            q: "Plato Dönemi Nedir? Ne Yapılmalı?",
            a: "Vücut bazen aylarca süren büyümeden sonra direnç gösterir ve uzama durur. Buna plato dönemi denir. Bu durumda paniğe kapılmayın; 1 hafta ara verin veya o ayı sadece 'sabitleme ayı' ilan edip gerginliği hiç artırmadan devam edin.",
            keys: ["plato", "durma", "büyümüyor", "direnç"]
        },
        {
            cat: "Gelişim Teknikleri",
            q: "Isınma (Warm-up) Yapmalı mıyım?",
            a: "Cihazı takmadan önce 2-3 dakika sıcak bir havlu veya sıcak su torbası ile bölgeyi ısıtmak dokuları yumuşatır. Isınmış doku %40 daha fazla esner ve yaralanma riski sıfıra iner.",
            keys: ["ısınma", "sıcak", "havlu", "hazırlık"]
        },
        {
            cat: "Gelişim Teknikleri",
            q: "Kegel Egzersizleri Büyümeyi Etkiler mi?",
            a: "Doğrudan boyu uzatmaz ama pelvik taban kaslarını güçlendirerek bölgeye giden kan pompasını artırır. Bu da extender seansları sonrası doku onarımının daha hızlı olmasını sağlar.",
            keys: ["kegel", "egzersiz", "spor", "pelvik"]
        }
    ];

    // Koç mesajlarını okunabilir HTML'e çevirmek için yardımcı fonksiyon
    function formatCoachMessage(text) {
        if (!text) return '';

        // ** kalın ** → <strong>
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // * veya - ile başlayan satırları madde işaretine çevir
        text = text.replace(/^[\*\-] (.+)/gm, '• $1');

        // # başlıkları kaldır, sadece metni bırak
        text = text.replace(/^#{1,3}\s+(.+)/gm, '<strong>$1</strong>');

        // Boş satırlara göre paragraflara böl
        const paragraphs = text.split(/\n{2,}/);
        
        return paragraphs
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .map(p => {
                // Paragraf içindeki tekli satır sonlarını <br> yap (ama manuel wrapping yapma)
                return `<p style="margin-bottom: 8px;">${p.replace(/\n/g, '<br>')}</p>`;
            })
            .join('');
    }

    function updateCoachSectionView() {
        // Render Chat History
        const chatContainer = document.getElementById('coachChatHistory');
        if (!chatContainer) return; // Safety

        const history = dataManager.data.coachChat || [];
        
        // Clear except first welcome message
        chatContainer.innerHTML = `
            <div class="chat-msg coach">
                <p>Merhaba! Ben senin sanal gelişim koçunum. Aletin kullanımı, kremler veya süreçle ilgili merak ettiğin her şeyi bana sorabilirsin. (Örn: "krem", "kaç saat", "ağrı")</p>
            </div>
        `;
        
        history.forEach(msg => {
            const div = document.createElement('div');
            div.className = `chat-msg ${msg.role}`;
            div.innerHTML = msg.role === 'coach'
                ? formatCoachMessage(msg.text)
                : `<p>${msg.text}</p>`;
            chatContainer.appendChild(div);
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Render Encyclopedia
        const encContainer = document.getElementById('encyclopediaContainer');
        if (!encContainer) return; // Safety
        
        encContainer.innerHTML = '';
        
        // Group by category
        const cats = {};
        coachKnowledgeBase.forEach(item => {
            if (!cats[item.cat]) cats[item.cat] = [];
            cats[item.cat].push(item);
        });

        Object.keys(cats).forEach(catName => {
            const catTitle = document.createElement('h4');
            catTitle.style = "font-size: 13px; color: #888; margin: 15px 0 8px 5px;";
            catTitle.textContent = catName.toUpperCase();
            encContainer.appendChild(catTitle);

            cats[catName].forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'encyclopedia-item';
                itemDiv.innerHTML = `
                    <div class="encyclopedia-header">
                        <span>${item.q}</span>
                        <span style="font-size:12px; opacity:0.5;">▼</span>
                    </div>
                    <div class="encyclopedia-body">${item.a}</div>
                `;
                itemDiv.addEventListener('click', () => {
                    const body = itemDiv.querySelector('.encyclopedia-body');
                    body.classList.toggle('open');
                });
                encContainer.appendChild(itemDiv);
            });
        });
    }

// GEMINI API Integration
async function askGemini(userMessage, context) {
    const apiKey = dataManager.data.geminiApiKey;
    const model = dataManager.data.geminiModelName || 'gemini-2.5-flash';
    if (!apiKey) return null;

    const cleanModel = model.replace('models/', '').trim();
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `CONTEXT: ${context}\n\nUSER QUESTION: ${userMessage}` }]
                }]
            })
        });

        const data = await response.json();
        if (data.error) return `❌ Gemini Hatası: ${data.error.message}`;
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        }
        return "⚠️ Yanıt alınamadı. API anahtarınızın seçili modele erişimi olduğundan emin olun.";
    } catch (error) {
        console.error("Gemini Fetch Error:", error);
        return "🚨 Bağlantı başarısız. İnternet erişiminizi veya API anahtarınızı (Ayarlar -> Gemini API Key) kontrol edip tekrar deneyin.";
    }
}

// ASK COACH Logic
document.getElementById('btnAskCoach').addEventListener('click', async () => {
    const queryInput = document.getElementById('coachQuery');
    const btn = document.getElementById('btnAskCoach');
    const text = queryInput.value.trim();
    if (!text) return;

    // Loading State
    const originalBtnText = btn.textContent;
    btn.textContent = "...";
    btn.disabled = true;

    // Save User Message
    dataManager.data.coachChat.push({ role: 'user', text: text });
    updateCoachSectionView();
    queryInput.value = '';

    let answer = "";
    
    // Prepare Context for AI
    const totalGrowth = dataManager.getTotalGrowth().toFixed(1);
    const stage = dataManager.getStage();
    const name = dataManager.data.name || "Kullanıcı";
    
    // Pump Data Context
    const pumpCount = Object.values(dataManager.data.dailyPump || {}).filter(v => v).length;
    const pumpStatus = dataManager.data.dailyPump[new Date().toISOString().split('T')[0]] ? "Bugün pompa yapıldı." : "Bugün pompa yapılmadı.";

    // Geçmiş veri özeti (AI için)
    const monthlySummary = Object.keys(dataManager.data.monthlyWork || {}).map(m => `${m}: ${dataManager.data.monthlyWork[m]}dk çalışma`).join(', ');

    const systemContext = `Sen UTakip uygulamasının uzman gelişim koçusun. 
    Kullanıcı: ${name}, Yaş: ${dataManager.data.age}, Gelişim: ${totalGrowth} mm (Aşama ${stage}).
    Pompa Verisi: Toplam ${pumpCount} gün pompa kullanıldı. ${pumpStatus}
    Geçmiş Özet: ${monthlySummary || 'Yok'}.
    Kural: Kısa ve öz cevap ver. Tıbbi tavsiye verme.`;

    const provider = dataManager.data.aiProvider || 'gemini';
    
    if (provider === 'gemini' && dataManager.data.geminiApiKey) {
        answer = await askGemini(text, systemContext);
    } else if (provider === 'minimax' && dataManager.data.minimaxApiKey) {
        answer = await askMiniMax(text, systemContext);
    } else {
        answer = "Lütfen Ayarlar sekmesinden bir AI sağlayıcısı (Gemini/MiniMax) ve API anahtarı seçin.";
    }

    // Save Coach Answer
    dataManager.data.coachChat.push({ role: 'coach', text: answer });
    dataManager.save();
    
    btn.textContent = originalBtnText;
    btn.disabled = false;
    updateCoachSectionView();
});

    // Enter key for Chat
    document.getElementById('coachQuery').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('btnAskCoach').click();
    });

    document.getElementById('btnClearCoachChat').addEventListener('click', () => {
        if (confirm('Tüm sohbet geçmişini temizlemek istediğinizden emin misiniz?')) {
            dataManager.data.coachChat = [];
            dataManager.save();
            updateCoachSectionView();
        }
    });

    function updateJournalView() {
        const container = document.getElementById('journalContainer');
        if (!container) return;
        container.innerHTML = '';

        const noteEntries = Object.entries(dataManager.data.notes);
        if (noteEntries.length === 0) {
            container.innerHTML = `<div class="card" style="text-align:center; padding: 40px 20px; opacity: 0.6;">
                <div style="font-size: 40px; margin-bottom: 10px;">✍️</div>
                <p>Henüz bir günlük kaydın bulunmuyor. Anasayfadan seans eklerken not yazmayı unutma!</p>
            </div>`;
            return;
        }

        // Sort by date descending
        noteEntries.sort((a, b) => b[0].localeCompare(a[0]));

        noteEntries.forEach(([date, notes]) => {
            const card = document.createElement('div');
            card.className = 'card journal-entry';
            card.style = "border-left: 3px solid #a5d6ff; margin-bottom: 5px;";
            
            const dateObj = new Date(date);
            const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' });
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 700; color: #a5d6ff; font-size: 14px;">${dateStr}</span>
                    <span style="font-size: 11px; opacity: 0.5;">${date}</span>
                </div>
                <div style="color: var(--text-primary); font-size: 14px; line-height: 1.5;">
                    ${notes.map((n, idx) => `<div style="margin-bottom: 8px; padding-bottom: 8px; ${idx < notes.length - 1 ? 'border-bottom: 1px solid rgba(255,255,255,0.05);' : ''}">
                        <span style="opacity: 0.8;">📝 ${n}</span>
                    </div>`).join('')}
                </div>
            `;
            container.appendChild(card);
        });
    }

    function generateCoachAdvice() {
        if (!dataManager.data.startSize) {
            return "Merhaba! Sana en iyi şekilde rehberlik edebilmem için lütfen 'Ayarlar' sekmesinden yaşını, temel ölçülerini ve hedeflerini kaydet.";
        }

        const name = dataManager.data.name || "dostum";
        const age = dataManager.data.age || 0;
        const currentSize = dataManager.data.currentSize > 0 ? dataManager.data.currentSize : dataManager.data.startSize;
        const targetSize = dataManager.data.targetSize;

        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const currentYYYYMM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        
        let monthTotalMins = dataManager.data.monthlyWork[currentYYYYMM] || 0;
        Object.keys(dataManager.data.sessions).forEach(dateStr => {
            if (dateStr.startsWith(currentYYYYMM)) {
                monthTotalMins += dataManager.data.sessions[dateStr].reduce((sum, s) => sum + (s.mins || 0), 0);
            }
        });
        
        const monthlyGrowth = dataManager.getMonthlyGrowth(currentYYYYMM);
        
        let consecutiveDays = 0;
        let daysActiveInWeek = 0;
        let chainBroken = false;
        
        for (let i = 0; i <= 10; i++) {
            const checkDate = new Date();
            checkDate.setDate(checkDate.getDate() - i);
            const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
            
            const hasSessions = (dataManager.data.sessions[dateStr] && dataManager.data.sessions[dateStr].length > 0);
            if (i < 7 && hasSessions) daysActiveInWeek++;
            
            if (i > 0) {
                if (hasSessions && !chainBroken) consecutiveDays++;
                else if (!hasSessions) chainBroken = true;
            }
        }

        const workedToday = (dataManager.data.sessions[todayStr] && dataManager.data.sessions[todayStr].length > 0);
        
        let healingFactor = age >= 40 ? "Senin yaş grubunda (+40) hücresel çoğalmanın ve doku esnemesinin oturması ekstra zamana ihtiyaç duyabilir. Dinlenmelere dikkat etmelisin. " : 
                           (age >= 30 ? "Vücut yaşın gereği dokuların mikroyırtıklardan arınıp esneyebilmesi için onlara fırsat vermelisin. " : "");

        // 0. SABİTLEME & KORUMA (Hedefe Ulaşılmışsa)
        if (targetSize > 0 && currentSize >= targetSize) {
            return `Merhaba <strong>${name}</strong>,<br>🎉 <strong>HEDEFE ULAŞTIN! (${currentSize} cm)</strong><br><br>Ancak işimiz henüz tam bitmedi! Hücre bölünmesiyle kazandığın yepyeni dokunun "olgunlaşması" ve kolajen yapısının sertleşip tamamen senin olması zaman alır. <strong>Kural:</strong> Hedefine ulaştıktan sonra, en az 3 ile 6 ay boyunca "düşük gerginlikte" (yaylar 0.5 - 1 boğum içerde olacak şekilde) günde sadece 1-2 saat <em>koruma amaçlı</em> takmaya devam etmelisin. Bu, dokunun hafızasına yeni boyutu kalıcı olarak kazıyacaktır! Aksi halde geri çekilme yaşayabilirsin.`;
        }

        // 2. AYLIK ÖLÇÜM HATIRLATMASI (Her ayın 1-3'ü arası)
        const dayOfMonth = d.getDate();
        if (dayOfMonth <= 3) {
            const nextMonthName = new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('tr-TR', { month: 'long' });
            return `Merhaba <strong>${name}</strong>, bugün <strong>Analiz ve Değerlendirme</strong> günümüz! Yeni bir aya başladık. Gelişimini doğru takip edebilmek için lütfen bugün ölçümünü yap ve 'Ayarlar' kısmından 'Mevcut Boyun' bilgisini güncelle. Bir sonraki hedef tarihini 1 ${nextMonthName} olarak belirledim, hadi göreyim seni!`;
        }

        // 3. ACİL DURUM UYARILARI (AŞIRI ÇALIŞMA VEYA TEMBELLİK)
        if (consecutiveDays >= 5 && !workedToday) {
            return `Merhaba <strong>${name}</strong>,<br>${healingFactor}Son <strong>${consecutiveDays} gündür</strong> aralıksız cihazı kullanıyorsun. Extender sistemlerinde penisin hücre bölünmesi yaşayabilmesi için mutlaka dinlenmeye ihtiyacı vardır. Haftada en az 1-2 gün ara vermen gelişimi hızlandıracaktır. Bugün cihazı takmamanı (dinlenme günü yapmanı) şiddetle tavsiye ederim.`;
        }

        if (daysActiveInWeek === 0 && !workedToday) {
            const target = targetSize ? targetSize + " cm'lik hedefine " : "hedeflerine ";
            return `Merhaba <strong>${name}</strong>,<br>Son günlerde hiç çalışma kaydı girmemişsin. Büyüme sürecindeki en önemli kural <strong>tutarlılıktır</strong>. ${target}kalıcı olarak ulaşmak için cihazı düzenli kullanmalısın. Hadi bugün güzel bir esneme seansıyla sahalara geri dön!`;
        }

        // 2. PERİYODİK ANALİZ (Ayın başı, ortası ve son 3 günü)
        const todayNum = d.getDate();
        const isAnalysisDay = [1, 2, 15, 28, 29, 30, 31].includes(todayNum);
        
        if (isAnalysisDay) {
            let msg = `Merhaba <strong>${name}</strong>, bugün <strong>Analiz ve Değerlendirme</strong> günümüz! Takvim verilerini detaylıca inceledim. `;
            if (monthTotalMins > 0) {
                const mText = monthlyGrowth > 0 ? ` ve bu ay uzama grafiğinde <strong>${monthlyGrowth.toFixed(1)} mm</strong> net gelişim kaydetmişsin` : "";
                msg += `Bu ay içerisinde takvime toplam <strong>${formatMinutes(monthTotalMins)}</strong> cihaz kullanım süresi aktarmışsın${mText}. `;
            } else {
                msg += `Henüz bu aya ait bir rutinin oluşmamış, istatistiklerini takip edebilmem için seans verilerini sistemli girmelisin. `;
            }
            
            if (workedToday) {
                msg += `Tüm bunların üstüne bugünkü seansını da başarıyla tamamlamışsın, harikasın. Çizgini bozmadan devam et!`;
            } else {
                if (consecutiveDays >= 4) {
                    msg += `Son günlerde oldukça iyi çalışmışsın. Değerlendirme günümüzün onuruna bugün dinlenme arası verip dokularının iyileşmesine fırsat tanıyabilirsin.`;
                } else {
                    msg += `Bu süreçteki gelişim hızını maksimuma çıkarmak için bugünkü dökümünü henüz yapmadıysan hemen cihazı kullanmaya bir saat ayır, iyi çalışmalar!`;
                }
            }
            return msg;
        }

        // 3. GÜNÜN TAVSİYESİ / UZMAN BİLGİSİ (Normal günlerde)
        const tips = [
            "<strong>Uzman Notu - Plato Dönemine Dikkat:</strong> Vücut bazen belirli bir uzunluktan sonra esnemeye direnç gösterir. Eğer 0.5 cm gerginliği artırdığınız ayda peniste uyuşma, deri çatlaması veya ereksiyon kalitesinde düşüş hissederseniz, o ayı <em>'sabitleme ayı'</em> ilan edin. Yeni artışa zorlamayın, mevcut boya uyum sağlamasını bekleyin.",
            "<strong>Hücresel Onarım Zırhı - Kremler:</strong> Çalışmadan sonra dokunun hızlı onarılması kolajen üretimiyle olur! Cihazı çıkardıktan sonra Panthenol (örn: Bepanthol) veya 'Madecassol' tarzı doku yenileyici merhemlerle çok hafif dairesel masaj yapmak cildi nemlendirir, çatlakları önler ve hücre bölünmesini muazzam destekler.",
            "<strong>Günün Bilgisi - Sabitleme (Konsolidasyon):</strong> Hedefinize varınca cihazı kutuya kaldırmayın! Hücre bölünmesiyle eklenen uzunluğun kalıcı olması (bağ dokusunun sertleşmesi) 3-6 ay sürer. Ulaştıktan sonra 3-6 ay boyunca gevşek yuvada (düşük gerginlik) günde 1 saat 'koruma seansı' yapın.",
            "<strong>Günün Beklentisi - Isınma (Warm-up):</strong> Cihazı takmadan hemen önce bölgeye 2-3 dakika ılık-sıcak havlu veya jel ped uygulamak dokuları pamuk gibi esnemeye hazırlar ve seans sırasındaki mikro onarımı %60 oranında artırır.",
            "<strong>Günün Bilgisi - Hücre Bölünmesi (Mitoz):</strong> Extender'ın mucizesi esnetmek değil, oluşturulan mikro gerilimlerin onarılmasını sağlamaktır. Asıl doku inşası işlemi, siz cihazı çıkardıktan sonra ve özellikle gece uyurken yoğun bir şekilde gerçekleşir.",
            "<strong>Beslenme Notu - Vücudun İnşaat Malzemesi:</strong> Bina dikmek için çimentoya ihtiyaç var! Yeni doku gelişimi yoğun kolajen proteinine ihtiyaç duyar. Kullanım sürecinde diyetinize fazladan C Vitamini (kolajeni sentezler), Çinko ve protein ağırlıklı besinler eklemelisiniz.",
            "<strong>Günün Bilgisi - Gerginlik Yanılgısı:</strong> Cihazı sırf çok uzasın diye maksimum gergide (aşırı vidalı) takmak sadece hücrelere kan gitmesini engeller ve dokuları strese sokup gelişimi yavaşlatır. Acı verici değil, ısıtan hafif tatlı bir esneme hissi arzuladığımız tek şeydir.",
            "<strong>Dinlenme Süreci (Rest Days):</strong> Sporda olduğu gibi penil gelişimde de cihazı sıkı tutarken büyümezsiniz; çıkardıktan sonraki kan dolumu anında büyürsünüz. Haftada 1-2 günü 'Rest Day' (dinlenme) günü şeçmek en zekice ilerleme yoludur.",
            "<strong>Günün Bilgisi - Soğuma (Cool-down) Jelleriyle:</strong> Seans sonrası E vitamini bakım yağları veya epitelizan (yenileyici) kremlerle hafif dairesel masajlar yapmak, o bölgeye taze kan toplayarak açılmış bağ dokularının yeni boyutta kalıcılaşmasını hızlandırır.",
            "<strong>Uzman Notu - Günlük Vakit Bölmek:</strong> Cihazı 4 saat boyunca delice tutup penisi boğmaktansa, 2'şer saatten 2 veya 3 seansa bölmek dokunun oksijensiz kalmasını (iskemi riskini) engeller, sinir dokularını kusursuz korur.",
            "<strong>Günün Uyarısı - Gerçek Ağrı Sınırı:</strong> Cihazı takarken glans bölgesinde morarma, soğukluk, beyazlama veya zonklama (şiddetli anlık ağrı) hissederseniz vidaları derhal geveşetin veya çıkarın. Penis asıp kurutulacak bir yapı değil damarlı canlı bir organımızdır.",
            "<strong>Günün Bilgisi - Açı Pratikleri (Yön):</strong> Her zaman dümdüz değil; yatakta aşağı, ayakta hafif çapraz veya dik açı gibi farklı kullanım şekilleri denemek iç 'suspansatuvar' bağları farklı yönlerden esnetip kuvvet uyarımı sağlar.",
            "<strong>Psikoloji Notu - Sabır Faktörü:</strong> Boyut artışı 'haftalık' takip edilmez. İlk aylarda inanılmaz gözle görünür sonuçlar aramak yerine, içerideki hücrelerin sessizce kalıcı temeli santim santim inşa ettiğine güvenip sistemli bir makine gibi rutine devam etmelisiniz.",
            "<strong>Günün Tavsiyesi - Kegel Pompası:</strong> Extender kullanmadığınız pasif saatlerde (masa başında otururken) periyodik olarak pelvik taban (PC) kaslarını sıkıp bırakmak, penis damarlarına doğal oksijen dolu yeni şok kanın pompalanmasını tetikler.",
            "<strong>Günün Korkulu Rüyası - Gece Kullanımı (Uyumak):</strong> İnternette uykuda takılabileceği söylenmesine asla aldanmayın! Erkeklerin biyolojik gece boyu 4-5 adet sabah dahil 'istemsiz güçlü ereksiyon' döngüsü vardır. Cihaz varken ereksiyon olmak sinir hasarına veya eğilmelerine yol açar.",
            "<strong>Günün Notu - Mezüra Manipülasyonu:</strong> Her sabah cetvele sarılıp milimleri kovalamak sizi inanılmaz bir hayal kırıklığına sürükler, ereksiyon psikolojinizi yorar. Her ay (30 günde 1) sadece aynı sahte şartlarda (soğuk-ılık ortam ölçümü benzer şekilde) raporlayın.",
            "<strong>Günün Bilgisi - Deri ve Mukozal Hasar:</strong> Cihazın silikon bağı veya kementi derinizi keserse kesinlikle kullanım durdurulmalı. Bunu önlemek için, ipin geçtiği bölgeye medikal pamuk sararak veya bebek pudrası uygulayarak sürtünmenin kesilmesini sağlayın.",
            "<strong>Uzman Bilgisi - İstemsiz Gevşemeler (Slip-Off):</strong> Takarken penis başınız yuvadan sıklıkla geriye kayıyorsa sünnet (coronal) etrafına ufak yapışkan elastik (koheziv - kendi kendine yapışan) bandaj sarmak hem acıyı emer hem de tutuş gücünü 5 katına çıkarır."
        ];
        
        let start = new Date(d.getFullYear(), 0, 0);
        let diff = d - start + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60 * 1000;
        let oneDay = 1000 * 60 * 60 * 24;
        let dayOfYear = Math.floor(diff / oneDay);
        
        // Global Tip
        let tipIndex = dayOfYear % tips.length;
        let selectedTip = tips[tipIndex];

        // --- Yapay Zeka Günlük Analizi (Context) ---
        let journalContext = "";
        const allNoteKeys = Object.keys(dataManager.data.notes || {}).sort().reverse();
        if (allNoteKeys.length > 0) {
            const lastNoteDate = allNoteKeys[0];
            const lastNotes = dataManager.data.notes[lastNoteDate];
            const lastNote = lastNotes[lastNotes.length - 1]; // En sonuncuyu al
            
            if (typeof lastNote === 'object') {
                journalContext = `<br><br><strong>Koç Analizi:</strong> Son günlüğünde `;
                if (lastNote.pain > 1) journalContext += `şiddetli acıdan bahsetmişsin, bugün vidayı biraz gevşetip dinlenmeye odaklanmalısın. `;
                else if (lastNote.pump) journalContext += `pompa kullanımı sonrası dokuların canlandığını görüyorum, bu harika. `;
                else if (lastNote.note) journalContext += `notlarını (<em>"${lastNote.note.substring(0, 30)}..."</em>) hafızama kaydettim. `;
                journalContext += `Seninle gelişimini takip etmeye devam ediyorum.`;
            }

            // Vida boyutu bağlamı (takvimden)
            const screwHistory = Object.entries(dataManager.data.dailyScrewSize || {})
                .filter(([k, v]) => v !== undefined && v !== null)
                .sort(([a], [b]) => b.localeCompare(a))
                .slice(0, 7);
            if (screwHistory.length > 0) {
                const latestScrew = screwHistory[0][1];
                const avgScrew = Math.round(screwHistory.reduce((s, [, v]) => s + v, 0) / screwHistory.length);
                journalContext += `<br>🔩 <strong>Vida Boyutu:</strong> Son kullanımda <strong>${latestScrew} mm</strong> vida boyutunda çalışmışsın. Son ${screwHistory.length} günün ortalaması ${avgScrew} mm. `;
            }
        }

        // Pompa Takip Analizi (v1.9.0)
        const pumpedToday = dataManager.data.dailyPump && dataManager.data.dailyPump[todayStr];
        const monthPumps = Object.keys(dataManager.data.dailyPump || {}).filter(k => k.startsWith(currentYYYYMM) && dataManager.data.dailyPump[k]).length;
        
        let pumpAdvice = "";
        if (pumpedToday) {
            pumpAdvice = `<br><br>🚀 <strong>Pompa Desteği:</strong> Bugün pompa kullanarak kan akışını artırmışsın. Bu, extender seansının verimini doku esnekliği açısından %30 artırabilir.`;
        } else if (monthPumps > 10) {
            pumpAdvice = `<br><br>🌀 <strong>Pompa Rutini:</strong> Bu ay ${monthPumps} gün pompa kullanmışsın. Oldukça istikrarlı bir destekçisin!`;
        }
        journalContext += pumpAdvice;

        let header = `Merhaba <strong>${name}</strong>,<br>`;
        
        if (workedToday) {
            return header + `Bugünkü hedefini başarıyla tamamlamışsın, harika gidiyorsun! Dinlenirken bugünün rehber tüyosuna (Uzmandan) mutlaka bir göz at:<br><br><span style="padding: 10px; display:inline-block; border:1px dashed #404040; background:rgba(0,0,0,0.1); border-radius: 8px;">${selectedTip}</span>` + journalContext;
        } else {
            return header + `Bugünkü extender sürecini henüz takvime dahil etmemiş görünüyorsun. Antrenmana başlamadan önce, sana tecrübelere dayanan harika bir anatomik tüyom var:\n\n<br><br><span style="padding: 10px; display:inline-block; border:1px dashed #404040; background:rgba(0,0,0,0.1); border-radius: 8px;">${selectedTip}</span>` + journalContext;
        }
    }


    let isUpdatingView = false;

    function updateSettingsView() {
        isUpdatingView = true;
        document.getElementById('userName').value = dataManager.data.name || '';
        document.getElementById('userAge').value = dataManager.data.age || '';
        document.getElementById('startDate').value = dataManager.data.startDate || '';
        document.getElementById('startSize').value = (dataManager.data.startSize !== undefined && !isNaN(dataManager.data.startSize)) ? dataManager.data.startSize : '';
        document.getElementById('targetSize').value = (dataManager.data.targetSize !== undefined && !isNaN(dataManager.data.targetSize)) ? dataManager.data.targetSize : '';
        document.getElementById('targetMonthlyGrowth').value = dataManager.data.targetMonthlyGrowth || 2;
        document.getElementById('aiProvider').value = dataManager.data.aiProvider || 'gemini';
        document.getElementById('geminiApiKey').value = dataManager.data.geminiApiKey || '';
        document.getElementById('minimaxApiKey').value = dataManager.data.minimaxApiKey || '';
        document.getElementById('geminiModelName').value = dataManager.data.geminiModelName || 'gemini-1.5-flash';
        
        // Toggle AI config visibility
        const provider = dataManager.data.aiProvider || 'gemini';
        document.getElementById('geminiConfig').style.display = provider === 'gemini' ? 'block' : 'none';
        document.getElementById('minimaxConfig').style.display = provider === 'minimax' ? 'block' : 'none';
        
        if(dataManager.data.currentSize !== undefined && dataManager.data.currentSize !== null && !isNaN(dataManager.data.currentSize)) {
            document.getElementById('currentSize').value = dataManager.data.currentSize;
        } else {
            document.getElementById('currentSize').value = '';
        }
        
        // Let's get the latest available tension, regardless of the month, so the input doesn't incorrectly seem 'cleared'
        let lastTension = 8.0; // Default 8.0cm (v2.1.7)
        if (dataManager.data.monthlyTension) {
            const tensionKeys = Object.keys(dataManager.data.monthlyTension).sort().reverse();
            if (tensionKeys.length > 0) {
                lastTension = dataManager.data.monthlyTension[tensionKeys[0]];
            }
        }
        document.getElementById('currentTension').value = lastTension;

        // Timer Settings
        document.getElementById('timerCount').value = dataManager.data.timerSettings.count;
        document.getElementById('timerDuration').value = dataManager.data.timerSettings.duration;
        document.getElementById('timerBreak').value = dataManager.data.timerSettings.break;
        document.getElementById('notifSound').checked = dataManager.data.timerSettings.sound;
        document.getElementById('notifVibrate').checked = dataManager.data.timerSettings.vibrate;

        // Cloud Sync Fields (Hardcoded, no DOM elements anymore)

        // Smart Cycle Settings
        document.getElementById('dailyGoalHours').value = dataManager.data.dailyGoalHours || 6;
        document.getElementById('workCycleDays').value = dataManager.data.workCycleDays || 5;
        document.getElementById('restCycleDays').value = dataManager.data.restCycleDays || 1;

        // Trigger Dependent UI Updates (v2.0.2)
        setTimeout(() => {
            // Re-initialize sliders (updates ranges if startSize changed)
            if (typeof initSmartCycleSliders === 'function') initSmartCycleSliders();

            // Update feedback boxes
            if (typeof updateTargetFeedback === 'function') updateTargetFeedback();
            if (typeof updateGrowthFeedback === 'function') updateGrowthFeedback();
            if (typeof updateGoalFeedback === 'function') updateGoalFeedback();
            if (typeof updateCycleFeedback === 'function') updateCycleFeedback();
            if (typeof updateTimerFeedback === 'function') updateTimerFeedback();

            // Refresh all smart sliders to match hidden inputs
            document.querySelectorAll('.smart-slider').forEach(slider => {
                if (typeof slider.refreshSlider === 'function') slider.refreshSlider();
            });
            
            // Force deactivate button to counter any automated change events on load
            setTimeout(() => { if(typeof deactivateSaveButton === 'function') deactivateSaveButton(); }, 100);
            
            // Allow auto-save again
            setTimeout(() => { isUpdatingView = false; }, 200);
        }, 50);
    }

    // --- EVENTS ---

    // --- SETTINGS SAVE BUTTON LOGIC ---
    const settingsContainer = document.getElementById('settings');
    // --- AYARLARI KAYDET (KİLİT KAPANINCA TETİKLENİR) ---
    function saveSettingsNow() {
        const name = document.getElementById('userName').value;
        const age = document.getElementById('userAge').value;
        const date = document.getElementById('startDate').value;
        const size = document.getElementById('startSize').value;
        const target = document.getElementById('targetSize').value;
        const growth = document.getElementById('targetMonthlyGrowth').value;
        const aiProvider = document.getElementById('aiProvider').value;
        const apiKey = document.getElementById('geminiApiKey').value;
        const minimaxKey = document.getElementById('minimaxApiKey').value;
        const modelName = document.getElementById('geminiModelName').value;
        const dailyGoal = document.getElementById('dailyGoalHours').value;
        
        const fbKey = dataManager.data.firebaseApiKey;
        const fbUrl = dataManager.data.firebaseDbUrl;
        const fbAuth = dataManager.data.firebaseAuthDomain;
        const fbId = dataManager.data.firebaseSyncId;
        const fbEnabled = dataManager.data.cloudSyncEnabled;

        const workCycle = document.getElementById('workCycleDays').value;
        const restCycle = document.getElementById('restCycleDays').value;

        // Timer Settings
        const tCount = document.getElementById('timerCount').value;
        const tDur = document.getElementById('timerDuration').value;
        const tBreak = document.getElementById('timerBreak').value;
        const tSound = document.getElementById('notifSound').checked;
        const tVib = document.getElementById('notifVibrate').checked;

        // Verileri Kaydet
        dataManager.setBaseSettings(name, age, date, size, target, growth, apiKey, modelName, dailyGoal, aiProvider, minimaxKey, fbKey, fbUrl, fbId, fbEnabled, workCycle, restCycle, fbAuth);
        dataManager.setTimerSettings(tCount, tDur, tBreak, tSound, tVib);

        if (fbEnabled && !firebaseApp) initCloudSync();

        updateHomeView();
        updateCalendarView();
        console.log("Global settings saved via lock toggle.");
    }

    if (settingsContainer) {
        settingsContainer.addEventListener('input', (e) => {
            // Görünüm güncellenirken tetiklenmeyi engelle
            if (isUpdatingView) return;
            
            // Sadece ayarlar sekmesi açıkken çalış (Autofill'in ezmesini önler)
            if (!settingsContainer.classList.contains('active')) return;
            // Timer feedback'i hemen güncelle
            if(e.target.id === 'timerDuration' || e.target.id === 'timerBreak') {
                if (typeof updateTimerFeedback === 'function') updateTimerFeedback();
            }
        });
        
        settingsContainer.addEventListener('change', (e) => {
            // Görünüm güncellenirken tetiklenmeyi engelle
            if (isUpdatingView) return;
            
            // Sadece ayarlar sekmesi açıkken çalış
            if (!settingsContainer.classList.contains('active')) return;
            
            // AI Provider değiştiğinde config alanlarını hemen aç/kapat
            if(e.target.id === 'aiProvider') {
                const val = e.target.value;
                document.getElementById('geminiConfig').style.display = val === 'gemini' ? 'block' : 'none';
                document.getElementById('minimaxConfig').style.display = val === 'minimax' ? 'block' : 'none';
            }
        });
    }

    document.getElementById('btnRequestNotif')?.addEventListener('click', async () => {
        if (!("Notification" in window)) {
            alert("Bu tarayıcı bildirimleri desteklemiyor.");
            return;
        }
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            alert("Bildirim izni verildi!");
            sendLocalNotification("UTakip", "Bildirimler başarıyla aktif edildi.");
        } else {
            alert("Bildirim izni reddedildi.");
        }
    });

    // Veri Yönetimi - Export
    document.getElementById('btnExportData')?.addEventListener('click', () => {
        const dataStr = JSON.stringify(dataManager.data, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `uTakip_Yedek_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('btnTestCloud')?.addEventListener('click', async () => {
        const btn = document.getElementById('btnTestCloud');
        const originalText = btn.textContent;
        btn.textContent = "⏳ Bağlanıyor...";
        btn.disabled = true;

        const fbKey = document.getElementById('firebaseApiKey').value;
        const fbUrl = document.getElementById('firebaseDbUrl').value;
        const fbAuth = document.getElementById('firebaseAuthDomain').value;
        const fbId = document.getElementById('firebaseSyncId').value;

        if (!fbKey || !fbUrl || !fbId) {
            alert("Lütfen tüm Firebase alanlarını doldurun.");
            btn.textContent = originalText;
            btn.disabled = false;
            return;
        }

        // Geçici olarak ayarları uygula
        dataManager.data.firebaseApiKey = fbKey;
        dataManager.data.firebaseDbUrl = fbUrl;
        dataManager.data.firebaseAuthDomain = fbAuth;
        dataManager.data.firebaseSyncId = fbId;
        dataManager.data.cloudSyncEnabled = true;

        initCloudSync();
        
        setTimeout(async () => {
             const success = await cloudSyncPullManual();
             if (success) {
                 showSuccessAchievement("Bağlantı Başarılı", "Veriler buluttan çekildi.", "☁️");
                 btn.textContent = "✅ Bağlantı Hazır";
             } else {
                 try {
                     cloudSyncPush();
                     showSuccessAchievement("Bağlantı Başarılı", "Yeni bulut profili oluşturuldu.", "☁️");
                     btn.textContent = "✅ Bağlantı Hazır";
                 } catch (e) {
                     alert("❌ Bağlantı Hatası: " + e.message);
                     btn.textContent = originalText;
                 }
             }
             btn.disabled = false;
        }, 1500);
    });

    document.getElementById('btnCancelSession')?.addEventListener('click', () => {
        if (confirm("Mevcut seansı kaydetmeden iptal etmek istediğinize emin misiniz?")) {
            const state = dataManager.data.activeSessionState;
            state.mode = 'ready';
            state.frozenElapsed = 0;
            dataManager.resetActiveSession();
            
            if (timerInterval) clearInterval(timerInterval);
            
            dataManager.save();
            updateTimerDisplay();
            updateHomeView();
            releaseWakeLock();
            
            showSuccessAchievement("Seans İptal Edildi", "Süre kaydedilmedi.", "✖");
        }
    });

    // Veri Yönetimi - Import
    document.getElementById('btnImportData')?.addEventListener('click', () => {
        document.getElementById('importFile').click();
    });

    document.getElementById('importFile')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (!importedData.sessions || !importedData.startDate) {
                    throw new Error("Geçersiz yedek dosyası.");
                }
                if (confirm("Mevcut verileriniz silinecek ve yedekteki veriler yüklenecek. Onaylıyor musunuz?")) {
                    localStorage.setItem('uTakipData', JSON.stringify(importedData));
                    location.reload();
                }
            } catch (err) {
                alert("Hata: " + err.message);
            }
        };
        reader.readAsText(file);
    });

    // PWA Güncelleme (v2.4.1 - Ultra Aggressive)
    document.getElementById('btnUpdateApp')?.addEventListener('click', async () => {
        const btn = document.getElementById('btnUpdateApp');
        const originalText = btn.textContent;
        btn.textContent = "🔄 Kontrol Ediliyor...";
        btn.disabled = true;

        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    btn.textContent = "🚀 Güncelleniyor (v2.4.2)...";
                    await registration.update();
                    
                    // Force cache clearing for PWA assets
                    if ('caches' in window) {
                        const keys = await caches.keys();
                        for (let key of keys) await caches.delete(key);
                    }
                    
                    // If after 2 seconds still no reload, force it
                    setTimeout(() => {
                        sessionStorage.setItem('app_just_updated', 'true');
                        window.location.reload(true);
                    }, 2000);
                } else {
                    if ('caches' in window) {
                        const keys = await caches.keys();
                        for (let key of keys) await caches.delete(key);
                    }
                    window.location.reload(true);
                }
            } catch (err) {
                console.error("SW Update Error:", err);
                if ('caches' in window) {
                    const keys = await caches.keys();
                    for (let key of keys) await caches.delete(key);
                }
                window.location.reload(true);
            }
        } else {
            window.location.reload(true);
        }
    });

    // Model Diagnostic Tool (v1.9.0 - MultiProvider)
    document.getElementById('btnCheckModels')?.addEventListener('click', async () => {
        const provider = document.getElementById('aiProvider').value;
        const output = document.getElementById('modelListOutput');
        output.style.display = 'block';
        output.textContent = "Bağlantı test ediliyor...";

        if (provider === 'gemini') {
            const apiKey = document.getElementById('geminiApiKey').value.trim();
            if (!apiKey) return alert("Önce Gemini API anahtarını girin.");
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                const data = await response.json();
                if (data.error) {
                    output.innerHTML = `<span style="color: #ff6b6b">❌ Hata: ${data.error.message}</span>`;
                } else if (data.models) {
                    const names = data.models
                        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                        .map(m => m.name.replace('models/', ''));
                    output.innerHTML = `<strong>Gemini Modelleri:</strong><br>` + names.join('<br>');
                }
            } catch (e) { output.textContent = "Hata: " + e.message; }
        } else {
            const apiKey = document.getElementById('minimaxApiKey').value.trim();
            if (!apiKey) return alert("Önce MiniMax API anahtarını girin.");
            try {
                // MiniMax model verification check (simple)
                output.textContent = "MiniMax API anahtarı doğrulanıyor...";
                const res = await askMiniMax("Merhaba, bağlantı testi.", "Bağlantı testi yapıyoruz.");
                if (res && !res.includes("❌")) {
                    output.innerHTML = `<span style="color: #2ecc71">✅ Bağlantı Başarılı (abab6.5s-chat)</span><br><small>${res.substring(0, 50)}...</small>`;
                } else {
                    output.innerHTML = `<span style="color: #ff6b6b">${res}</span>`;
                }
            } catch (e) { output.textContent = "Hata: " + e.message; }
        }
    });



    // --- OTOMATİK KAYIT: GÜNCEL VERİLER (v2.4.1) ---
    let autoSaveCurrentTimer = null;
    function triggerAutoSaveCurrent() {
        if (autoSaveCurrentTimer) clearTimeout(autoSaveCurrentTimer);
        autoSaveCurrentTimer = setTimeout(() => {
            const cs = document.getElementById('currentSize').value;
            const ct = document.getElementById('currentTension').value;
            if(!cs && !ct) return;
            
            dataManager.setCurrentData(cs, ct);
            // Sessiz kayıt (alert yok), görünümleri güncelle
            updateHomeView();
            updateCalendarView();
        }, 800);
    }

    document.getElementById('currentSize')?.addEventListener('input', triggerAutoSaveCurrent);
    document.getElementById('currentTension')?.addEventListener('input', triggerAutoSaveCurrent);

    document.getElementById('btnToggleManual')?.addEventListener('click', () => {
        const card = document.getElementById('timerCard');
        if (!card) return;
        
        // Pompa çalışırken geçişe izin verme (updateTimerDisplay zaten butonu kilitler ama burası ikinci katman)
        if (pumpEndTime > 0) return;

        if (card.classList.contains('mode-manual') || card.classList.contains('is-manual-view')) {
            card.classList.remove('mode-manual');
            card.classList.remove('is-manual-view');
            localStorage.setItem('timer_entry_mode', 'timer');
            const icon = document.querySelector('#btnToggleManual span');
            if (icon) icon.textContent = 'edit_calendar';
        } else {
            // DİĞER MODU KAPAT (EXCLUSIVITY)
            card.classList.remove('mode-pump');
            const pumpIcon = document.querySelector('#btnTogglePump span');
            if (pumpIcon) pumpIcon.textContent = 'mode_fan';

            card.classList.add('mode-manual');
            card.classList.add('is-manual-view');
            localStorage.setItem('timer_entry_mode', 'manual');
            const icon = document.querySelector('#btnToggleManual span');
            if (icon) icon.textContent = 'timer';
        }
        updateTimerDisplay();
    });

    document.getElementById('btnTogglePump')?.addEventListener('click', () => {
        const card = document.getElementById('timerCard');
        if (!card) return;

        if (card.classList.contains('mode-pump')) {
            card.classList.remove('mode-pump');
            const icon = document.querySelector('#btnTogglePump span');
            if (icon) icon.textContent = 'mode_fan';
        } else {
            card.classList.remove('mode-manual');
            card.classList.remove('is-manual-view');
            const manualIcon = document.querySelector('#btnToggleManual span');
            if (manualIcon) manualIcon.textContent = 'edit_calendar';
            
            card.classList.add('mode-pump');
            const icon = document.querySelector('#btnTogglePump span');
            if (icon) icon.textContent = 'close';
        }
        updateTimerDisplay();
    });

    const initPumpDur = localStorage.getItem('pump_duration');
    const pdElem = document.getElementById('pumpDuration');
    if (initPumpDur && pdElem) {
        pdElem.value = initPumpDur;
    }

    pdElem?.addEventListener('change', (e) => {
        localStorage.setItem('pump_duration', e.target.value);
        if (pumpEndTime === 0) updateTimerDisplay();
    });

    document.getElementById('btnStartPump')?.addEventListener('click', () => {
        if (pumpEndTime > 0) {
            pumpEndTime = 0;
            if (pumpInterval) clearInterval(pumpInterval);
            pumpInterval = null;
            updateTimerDisplay();
            releaseWakeLock();
        } else {
            const pd = document.getElementById('pumpDuration');
            const d = pd ? parseInt(pd.value) || 15 : 15;
            pumpEndTime = Date.now() + (d * 60000);
            requestWakeLock();
            
            if (pumpInterval) clearInterval(pumpInterval);
            pumpInterval = setInterval(() => {
                if (pumpEndTime > 0 && Date.now() >= pumpEndTime) {
                    pumpEndTime = 0;
                    clearInterval(pumpInterval);
                    pumpInterval = null;
                    if (window.navigator && window.navigator.vibrate) {
                        window.navigator.vibrate([500, 200, 500, 200, 1000]);
                    }
                    setTimeout(() => alert("🔔 Pompa Süresi Doldu!"), 100);
                    updateTimerDisplay();
                    releaseWakeLock();
                } else {
                    updateTimerDisplay();
                }
            }, 1000);
            updateTimerDisplay();
        }
    });

    document.getElementById('btnSaveManual').addEventListener('click', () => {
        const hours = parseInt(document.getElementById('inputHours').value) || 0;
        const minutes = parseInt(document.getElementById('inputMinutes').value) || 0;
        const diffStr = document.getElementById('inputDifficulty').value;
        const noteStr = document.getElementById('inputNote').value;
        const totalMinutes = (hours * 60) + minutes;
        
        if (totalMinutes <= 0) return alert('Lütfen geçerli bir süre girin.');

        const today = new Date();
        const offset = today.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(today - offset)).toISOString().split('T')[0];

        if(dataManager.addSession(localISOTime, totalMinutes, diffStr, noteStr)) {
            // Reset input with animation
            const card = document.getElementById('timerCard');
            card.style.transform = 'scale(0.98)';
            card.style.opacity = '0.7';
            
            setTimeout(() => {
                document.getElementById('inputHours').value = '0';
                document.getElementById('inputMinutes').value = '0';
                document.getElementById('inputNote').value = '';
                document.getElementById('inputDifficulty').value = 'normal';
                
                card.style.transform = 'scale(1)';
                card.style.opacity = '1';
                
                showSuccessAchievement("Başarıyla Kaydedildi", `${hours}s ${minutes}dk manuel olarak kaydedildi.`, "💾");
                updateHomeView();
            }, 300);
        }
    });

    document.getElementById('btnFinalizeSession')?.addEventListener('click', () => {
        const state = dataManager.data.activeSessionState;
        const elapsedMs = state.frozenElapsed || (Date.now() - state.startTime);
        const totalMins = Math.floor(elapsedMs / 60000);
        const diffStr = document.getElementById('inputDifficulty').value;
        const noteStr = document.getElementById('inputNote').value;

        if (totalMins > 0) {
            const today = new Date();
            const offset = today.getTimezoneOffset() * 60000;
            const localISOTime = (new Date(today - offset)).toISOString().split('T')[0];
            
            if (dataManager.addSession(localISOTime, totalMins, diffStr, noteStr)) {
                showSuccessAchievement("Seans Kaydedildi", `${totalMins} dakika günlüğe eklendi.`, "✅");
            }
        }
        
        // Reset and animate back to ready
        const card = document.getElementById('timerCard');
        card.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        card.style.opacity = '0';
        card.style.transform = 'translateY(10px)';

        setTimeout(() => {
            state.mode = 'ready';
            state.frozenElapsed = 0;
            dataManager.resetActiveSession();
            // Clear inputs
            document.getElementById('inputNote').value = '';
            document.getElementById('inputDifficulty').value = 'normal';
            
            dataManager.save();
            updateTimerDisplay();
            updateHomeView();
            
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 500);
        
        releaseWakeLock();
    });

    document.getElementById('btnUpdateApp')?.addEventListener('click', () => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for (let registration of registrations) {
                    registration.update();
                }
                alert("Güncelleme kontrol ediliyor... Uygulama şimdi yenilenecek.");
                location.reload(true);
            });
        } else {
            location.reload(true);
        }
    });

    document.getElementById('btnClearData').addEventListener('click', () => {
        if(confirm("Tüm gelişiminizi kalıcı olarak silmek istediğinize emin misiniz?")) {
            localStorage.removeItem('uTakipData');
            location.reload();
        }
    });

    // --- WAKE LOCK API ---
    let wakeLockObj = null;
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLockObj = await navigator.wakeLock.request('screen');
            }
        } catch (err) { console.warn("Wake Lock error:", err); }
    }
    function releaseWakeLock() {
        if (wakeLockObj !== null) {
            wakeLockObj.release();
            wakeLockObj = null;
        }
    }

    // --- PUMP TIMER LOGIC ---
    let pumpInterval = null;
    let pumpEndTime = 0;

    // --- TIMER LOGIC ---
    let timerInterval = null;

    function updateTimerDisplay() {
        const display = document.getElementById('timerDisplay');
        const btnSession = document.getElementById('btnStartSession');
        const btnBreak = document.getElementById('btnStartBreak');
        const btnFinalize = document.getElementById('btnFinalizeSession');
        const btnCancel = document.getElementById('btnCancelSession');
        const info = document.getElementById('timerSessionInfo');
        const badge = document.getElementById('timerModeBadge');
        const card = document.getElementById('timerCard');
        const manualSection = document.getElementById('manualTimeSection');
        const metaSection = document.getElementById('sessionMetaSection');
        const saveManualBtn = document.getElementById('btnSaveManual');
        const btnStartPump = document.getElementById('btnStartPump');
        const pumpSection = document.getElementById('pumpSettingSection');
        const pumpDisplay = document.getElementById('pumpTimerDisplay');
        const btnToggleManual = document.getElementById('btnToggleManual');
        const btnTogglePump = document.getElementById('btnTogglePump');

        if (!display || !btnSession || !btnBreak || !info || !card || !manualSection || !metaSection) return;

        const state = dataManager.data.activeSessionState;
        const isManualMode = card.classList.contains('mode-manual') || card.classList.contains('is-manual-view');
        const isPumpMode = card.classList.contains('mode-pump');

        // --- 1. HER ŞEYİ GİZLE (ÖNCE TEMİZLİK) ---
        display.style.display = 'none';
        manualSection.style.display = 'none';
        metaSection.style.display = 'none';
        saveManualBtn.style.display = 'none';
        btnSession.style.display = 'none';
        btnBreak.style.display = 'none';
        btnFinalize.style.display = 'none';
        if (pumpSection) pumpSection.style.display = 'none';
        if (btnStartPump) btnStartPump.style.display = 'none';
        if (btnCancel) btnCancel.style.display = 'none';

        // --- 2. MODLARI AYRI AYRI İŞLE (EXCLUSIVITY) ---

        // A) POMPA MODU
        if (isPumpMode) {
            if (pumpSection) pumpSection.style.display = 'block';
            if (btnStartPump) btnStartPump.style.display = 'block';
            
            // DİĞERLERİNİ GİZLE
            display.style.display = 'none';
            manualSection.style.display = 'none';
            metaSection.style.display = 'none';

            if (pumpEndTime > 0) {
                info.textContent = '🌀 POMPA SÜRECİ';
                if (btnStartPump) { btnStartPump.textContent = '⏹ Pompayı Durdur'; btnStartPump.className = 'btn-danger'; }
                if (btnToggleManual) { btnToggleManual.disabled = true; btnToggleManual.style.opacity = '0.3'; }
                if (btnTogglePump) { btnTogglePump.disabled = true; btnTogglePump.style.opacity = '0.3'; }
                
                const remaining = pumpEndTime - Date.now();
                if (remaining <= 0) {
                    if (pumpDisplay) pumpDisplay.textContent = '00:00';
                } else {
                    const rs = Math.ceil(remaining / 1000);
                    const rm = Math.floor(rs / 60);
                    const rss = rs % 60;
                    if (pumpDisplay) { 
                        pumpDisplay.textContent = `${String(rm).padStart(2,'0')}:${String(rss).padStart(2,'0')}`; 
                        pumpDisplay.classList.add('is-running'); 
                    }
                }
                const hint = document.getElementById('pumpEditHint');
                if (hint) hint.classList.add('hidden');
            } else {
                info.textContent = '🌀 POMPA MODU';
                if (btnStartPump) { btnStartPump.textContent = '▶ Pompayı Başlat'; btnStartPump.className = 'btn-primary'; }
                if (btnToggleManual) { btnToggleManual.disabled = false; btnToggleManual.style.opacity = '1'; }
                if (btnTogglePump) { btnTogglePump.disabled = false; btnTogglePump.style.opacity = '1'; }
                
                const durationInput = document.getElementById('pumpDuration');
                const d = durationInput ? (parseInt(durationInput.value) || 15) : 15;
                if (pumpDisplay) { 
                    pumpDisplay.textContent = `${String(d).padStart(2,'0')}:00`; 
                    pumpDisplay.classList.remove('is-running'); 
                }
                const hint = document.getElementById('pumpEditHint');
                if (hint) hint.classList.remove('hidden');
            }
            return;
        }
        // Apply Manual View UI if idle
        if (isManualMode && state.mode === 'ready') {
            display.style.display = 'none';
            manualSection.style.display = 'block';
            metaSection.style.display = 'block';
            saveManualBtn.style.display = 'block';
            
            btnSession.style.display = 'none';
            btnBreak.style.display = 'none';
            btnFinalize.style.display = 'none';
            if (btnCancel) btnCancel.style.display = 'none';
            if (pumpSection) pumpSection.style.display = 'none';
            if (btnStartPump) btnStartPump.style.display = 'none';
            
            info.textContent = '📝 MANUEL GİRİŞ MODU';
            card.className = card.className.replace(/mode-\w+/g, '');
            card.classList.add('mode-ready', 'mode-manual', 'is-manual-view');
            return;
        } else {
            display.style.display = 'block';
            manualSection.style.display = 'none';
            saveManualBtn.style.display = 'none';
            if (pumpSection) pumpSection.style.display = 'none';
            if (btnStartPump) btnStartPump.style.display = 'none';
            
            // Normal moddayken pompa butonunu aç (eğer seans aktif değilse)
            if (btnTogglePump) {
                const isSessionActive = state.mode !== 'ready';
                btnTogglePump.disabled = isSessionActive;
                btnTogglePump.style.opacity = isSessionActive ? '0.3' : '1';
                btnTogglePump.style.cursor = isSessionActive ? 'not-allowed' : 'pointer';
            }
        }

        if (state.mode === 'ready') {
            display.textContent = '00:00:00';
            display.style.opacity = '1';
            
            btnSession.style.display = 'block';
            btnSession.textContent = '▶ Seans Başlat';
            btnSession.className = 'btn-primary';
            
            btnBreak.style.display = 'block';
            btnBreak.textContent = '☕ Mola Başlat';
            btnBreak.className = 'btn-secondary';
            
            btnFinalize.style.display = 'none';
            if (btnCancel) btnCancel.style.display = 'none';
            metaSection.style.display = 'block';
            
            info.textContent = '⏱️ SEANS MODU';
            card.classList.remove('is-manual-view', 'mode-manual', 'mode-pump', 'mode-work', 'mode-break', 'mode-review');
            card.classList.add('mode-ready');
            return;
        }

        card.classList.remove('mode-ready');

        if (state.mode === 'review') {
            const elapsedMs = state.frozenElapsed || 0;
            const totalSecs = Math.floor(elapsedMs / 1000);
            const h = Math.floor(totalSecs / 3600);
            const m = Math.floor((totalSecs % 3600) / 60);
            const s = totalSecs % 60;
            display.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
            display.style.opacity = '0.4'; 
            
            btnSession.style.display = 'none';
            btnBreak.style.display = 'none';
            saveManualBtn.style.display = 'none';
            btnFinalize.style.display = 'block';
            if (btnCancel) btnCancel.style.display = 'none';
            
            manualSection.style.display = 'none';
            metaSection.style.display = 'block';
            if (badge) {
                badge.textContent = 'Kayıt Bekliyor';
                badge.className = 'timer-badge mode-review';
            }
            card.className = card.className.replace(/mode-\w+/g, '');
            card.classList.add('mode-review');
            return;
        }

        const elapsedMs = Date.now() - state.startTime;
        const totalSecs = Math.floor(elapsedMs / 1000);
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;
        display.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        display.style.opacity = '1';

        btnFinalize.style.display = 'none';
        if (btnCancel) btnCancel.style.display = 'block';
        
        if (state.mode === 'work') {
            metaSection.style.display = 'none'; // Çalışırken gizle
            info.textContent = '⏱️ SAYAÇ ÇALIŞIYOR';
            if (badge) {
                badge.textContent = 'Çalışma Modu';
                badge.className = 'timer-badge mode-work';
            }
            card.classList.add('mode-work');
            card.classList.remove('mode-break');
            btnSession.textContent = '⏹ Seansı Bitir';
            btnSession.className = 'btn-danger';
            btnBreak.textContent = '☕ Mola Başlat';
            btnBreak.className = 'btn-secondary';

            const limitMins = dataManager.data.timerSettings.duration;
            const currentMins = Math.floor(elapsedMs / 60000);
            if (currentMins >= limitMins && !state.notified) {
                state.notified = true;
                dataManager.save();
                triggerAlert(`Seans ${state.current} Tamamlandı!`, "Şimdi cihazı çıkarıp mola verebilirsin.");
            }
        } else if (state.mode === 'break') {
            metaSection.style.display = 'none';
            info.textContent = `Mola Süreci`;
            card.classList.add('mode-break');
            card.classList.remove('mode-work');
            btnSession.textContent = '▶ Seans Başlat';
            btnSession.className = 'btn-primary';
            btnBreak.textContent = '⏹ Molayı Bitir';
            btnBreak.className = 'btn-danger';

            const breakLimitMins = dataManager.data.timerSettings.break;
            const currentMins = Math.floor(elapsedMs / 60000);
            if (currentMins >= breakLimitMins && !state.notified) {
                state.notified = true;
                dataManager.save();
                triggerAlert("Mola Bitti!", "Sıradaki seansa hazır mısın?");
            }
        }
    }

    function triggerAlert(title, body) {
        sendLocalNotification(title, body);
        if (dataManager.data.timerSettings.sound) playNotificationSound();
        if (dataManager.data.timerSettings.vibrate) vibrateDevice();
        showSuccessAchievement(title, body, "🔔");
    }

    function startTimerUI() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(updateTimerDisplay, 1000);
        updateTimerDisplay();
    }

    /* --- EDIT MODAL LOGIC (Nuclear Fix) --- */
    let currentEditDate = null;
    const editModal = document.getElementById('editModalOverlay');

    function openEditModal(dateStr) {
        currentEditDate = dateStr;
        document.getElementById('h_edit').value = 0;
        document.getElementById('m_edit').value = 0;
        document.getElementById('editTotalMinsLabel').textContent = 0;
        
        const dateObj = new Date(dateStr);
        document.getElementById('editModalTargetDate').textContent = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
        editModal.classList.add('show');
    }

    function closeEditModal() {
        editModal.classList.remove('show');
        currentEditDate = null;
    }

    /* --- NOTE MODAL LOGIC (v1.9.5) --- */
    let currentNoteDate = null;
    const noteModal = document.getElementById('noteModalOverlay');
    let selectedNotePain = 0;

    function openNoteModal(dateStr) {
        currentNoteDate = dateStr;
        const noteData = dataManager.getDailyNote(dateStr);
        
        document.getElementById('noteModalText').value = noteData ? (noteData.note || "") : "";
        document.getElementById('noteModalPump').checked = noteData ? (!!noteData.pump) : false;
        document.getElementById('noteModalMast').checked = noteData ? (!!noteData.mast) : false;
        
        selectedNotePain = noteData ? (noteData.pain || 0) : 0;
        document.querySelectorAll('#noteModalPain .btn-pain').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.getAttribute('data-val')) === selectedNotePain);
        });

        const dateObj = new Date(dateStr);
        document.getElementById('noteModalTargetDate').textContent = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
        noteModal.classList.add('show');
    }

    function closeNoteModal() {
        noteModal.classList.remove('show');
        currentNoteDate = null;
    }

    document.querySelectorAll('#noteModalPain .btn-pain').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#noteModalPain .btn-pain').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedNotePain = parseInt(btn.getAttribute('data-val'));
        });
    });

    document.getElementById('btnCancelNote')?.addEventListener('click', closeNoteModal);
    noteModal.addEventListener('click', (e) => {
        if(e.target === noteModal) closeNoteModal();
    });

    document.getElementById('btnSaveNote')?.addEventListener('click', () => {
        if(!currentNoteDate) return;
        
        const noteText = document.getElementById('noteModalText').value;
        const notePump = document.getElementById('noteModalPump').checked;
        const noteMast = document.getElementById('noteModalMast').checked;

        dataManager.saveDailyNote(currentNoteDate, {
            note: noteText,
            pump: notePump,
            mast: noteMast,
            pain: selectedNotePain
        });

        closeNoteModal();
        updateCalendarView();
        updateHomeView();
        showSuccessAchievement("Not Kaydedildi", "Günlük notun başarıyla güncellendi.", "📝");
    });

    document.querySelectorAll('.modal-stepper-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            const dir = parseInt(btn.getAttribute('data-modal-dir')) || 0;
            const activeBox = document.querySelector('.edit-modal .dual-box.active');
            if(!activeBox) return;
            
            const targetId = activeBox.getAttribute('data-modal-target');
            const inputField = document.getElementById(targetId);
            if (!inputField) return;

            let currentVal = parseInt(inputField.value) || 0;
            const stepSize = (targetId === 'm_edit') ? 5 : 1;
            
            currentVal += (dir * stepSize);
            
            if (currentVal < 0) currentVal = 0;
            if (targetId === 'm_edit' && currentVal > 59) currentVal = 55;
            if (targetId === 'h_edit' && currentVal > 23) currentVal = 23;
            
            inputField.value = currentVal;
            
            const hVal = parseInt(document.getElementById('h_edit').value) || 0;
            const mVal = parseInt(document.getElementById('m_edit').value) || 0;
            document.getElementById('editTotalMinsLabel').textContent = (hVal * 60) + mVal;
        });
    });

    document.querySelectorAll('.edit-modal .dual-box').forEach(box => {
        box.addEventListener('click', () => {
            document.querySelectorAll('.edit-modal .dual-box').forEach(b => b.classList.remove('active'));
            box.classList.add('active');
        });
    });

    document.getElementById('btnCancelEdit')?.addEventListener('click', closeEditModal);
    editModal.addEventListener('click', (e) => {
        if(e.target === editModal) closeEditModal();
    });

    document.getElementById('btnSaveEditModal')?.addEventListener('click', () => {
        if(!currentEditDate) return;
        const h = parseInt(document.getElementById('h_edit').value) || 0;
        const m = parseInt(document.getElementById('m_edit').value) || 0;
        const totalMins = (h * 60) + m;

        if (totalMins <= 0) return alert('Lütfen eklenecek geçerli bir süre girin.');
        if (dataManager.addSession(currentEditDate, totalMins, 'normal', 'Geçmişe dönük seans eklendi.')) {
            closeEditModal();
            updateCalendarView();
            updateHomeView();
            showSuccessAchievement("Başarılı!", "Tarihe yeni seans eklendi.", "📅");
        }
    });

    function manualSaveAndEndSession() {
        const state = dataManager.data.activeSessionState;
        const elapsedMs = Date.now() - state.startTime;
        
        if (timerInterval) clearInterval(timerInterval);
        
        const totalMins = Math.floor(elapsedMs / 60000);
        const diffStr = document.getElementById('inputDifficulty').value;
        const noteStr = document.getElementById('inputNote').value;

        if (totalMins > 0) {
            const today = new Date();
            const offset = today.getTimezoneOffset() * 60000;
            const localISOTime = (new Date(today - offset)).toISOString().split('T')[0];
            
            if (dataManager.addSession(localISOTime, totalMins, diffStr, noteStr)) {
                showSuccessAchievement("Seans Kaydedildi", `${totalMins} dakika günlüğe eklendi.`, "✅");
            }
        }
        
        const card = document.getElementById('timerCard');
        if(card) {
            card.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
            card.style.opacity = '0';
            card.style.transform = 'translateY(10px)';
        }

        setTimeout(() => {
            state.mode = 'ready';
            state.frozenElapsed = 0;
            dataManager.resetActiveSession();
            
            const noteEl = document.getElementById('inputNote');
            if(noteEl) noteEl.value = '';
            const diffEl = document.getElementById('inputDifficulty');
            if(diffEl) diffEl.value = 'normal';
            
            dataManager.save();
            updateTimerDisplay();
            updateHomeView();
            
            if(card) {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }
        }, 500);
        
        releaseWakeLock();
    }

    document.getElementById('btnStartSession')?.addEventListener('click', () => {
        const state = dataManager.data.activeSessionState;

        if (state.mode === 'work') {
            // Seansı Durdur
            manualSaveAndEndSession();
        } else {
            // Başlat (Ready veya Break modundan Session'a geçer)
            if (state.mode === 'break') {
               // molayı durdur, sonraki seansa başlanacak
               state.current++;
            }
            
            state.mode = 'work';
            state.startTime = Date.now();
            state.notified = false;
            dataManager.save();
            startTimerUI();
            requestWakeLock();
        }
    });

    document.getElementById('btnStartBreak')?.addEventListener('click', () => {
        const state = dataManager.data.activeSessionState;

        if (state.mode === 'break') {
            // Molayı Durdur -> Ready
            state.mode = 'ready';
            dataManager.save();
            updateTimerDisplay();
            releaseWakeLock();
        } else {
            // Mola Başlat (Work'ten veya Ready'den geçer)
            if (state.mode === 'work') {
                manualSaveAndEndSession();
            }
            
            // Re-fetch state after manualSaveAndEndSession because it could be reset
            const newState = dataManager.data.activeSessionState;
            if(newState.current >= dataManager.data.timerSettings.count && newState.current == 1 && newState.mode == 'ready' ) {
                // Was completely reset
            } else {
                newState.mode = 'break';
                newState.startTime = Date.now();
                newState.notified = false;
                dataManager.save();
                startTimerUI();
            }
        }
    });

    // --- INTERACTIVE INPUT LOGIC (Scroll & Swipe) ---
    function initInteractiveInputs() {
        const inputs = document.querySelectorAll('.modern-stepper-input');
        
        inputs.forEach(input => {
            // Disable default wheel behavior to prevent page scroll
            input.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 1 : -1;
                handleStep(input, delta);
            }, { passive: false });

            // Touch support
            let touchStartY = 0;
            const threshold = 10; // pixels to trigger change

            input.addEventListener('touchstart', (e) => {
                touchStartY = e.touches[0].clientY;
            }, { passive: true });

            input.addEventListener('touchmove', (e) => {
                const currentY = e.touches[0].clientY;
                const diff = touchStartY - currentY; // Upward move is positive diff

                if (Math.abs(diff) > threshold) {
                    const delta = diff > 0 ? 1 : -1;
                    handleStep(input, delta);
                    touchStartY = currentY; // Reset for continuous sliding
                    
                    if (e.cancelable) e.preventDefault();
                }
            }, { passive: false });
        });

        function handleStep(input, direction) {
            const step = parseFloat(input.step) || 1;
            const min = !isNaN(parseFloat(input.min)) ? parseFloat(input.min) : -Infinity;
            const max = !isNaN(parseFloat(input.max)) ? parseFloat(input.max) : Infinity;
            
            let val = parseFloat(input.value) || 0;
            val += (direction * step);

            // Precision and constraints
            if (input.id === 'userAge' || input.id.includes('Days')) {
                val = Math.round(val);
            } else {
                val = Math.round(val * 100) / 100;
            }

            if (val < min) val = min;
            if (val > max) val = max;

            input.value = val;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // Initialize interactive inputs
    initInteractiveInputs();

    // --- SMART CYCLE SLIDER LOGIC (v2.0.0) ---
    function initSmartCycleSliders() {
        const sliders = document.querySelectorAll('.smart-slider');
        
        sliders.forEach(slider => {
            const targetId = slider.id.replace('slider-', '');
            let min = parseFloat(slider.dataset.min);
            let max = parseFloat(slider.dataset.max);
            const step = parseFloat(slider.dataset.step) || 1;

            // DİNAMİK HEDEF AYARI: Başlangıç boyutuna göre aralığı güncelle
            if (targetId === 'targetSize') {
                const startVal = parseFloat(document.getElementById('startSize').value) || 0;
                if (startVal > 0) {
                    min = startVal + 0.5;
                    max = startVal + 5.0;
                    slider.classList.remove('disabled');
                } else {
                    slider.classList.add('disabled');
                }
            }

            const pointsContainer = slider.querySelector('.slider-points');
            const thumb = slider.querySelector('.slider-thumb');
            const valueSpan = document.getElementById(`val-${targetId}`);
            const hiddenInput = document.getElementById(targetId);

            // Listener check (v2.0.2)
            const hasListeners = slider.dataset.initialized === "true";

            // Generate Points
            pointsContainer.innerHTML = '';
            for (let i = min; i <= max; i = parseFloat((i + step).toFixed(2))) {
                if (i > max) break;
                
                const point = document.createElement('div');
                point.className = 'slider-point';
                point.dataset.value = i;
                point.dataset.label = i;
                
                // Color coding based on research
                if (targetId === 'workCycleDays') {
                    if (i <= 3) point.classList.add('status-low');
                    else if (i <= 7) point.classList.add('status-ideal');
                    else if (i <= 9) point.classList.add('status-high');
                    else point.classList.add('status-danger');
                } else if (targetId === 'dailyGoalHours') {
                    if (i <= 3) point.classList.add('status-low');
                    else if (i <= 8) point.classList.add('status-ideal');
                    else if (i <= 11) point.classList.add('status-high');
                    else point.classList.add('status-danger');
                    point.dataset.label = i; 
                } else if (targetId === 'targetSize') {
                    const startSize = parseFloat(document.getElementById('startSize').value) || 0;
                    const gain = i - startSize;
                    if (gain <= 1.5) point.classList.add('status-ideal');
                    else if (gain <= 3.0) point.classList.add('status-high');
                    else point.classList.add('status-danger');
                    // Sadece tam sayıları veya 2.5 gibi kritik değerleri etiketle
                    if (i % 1 !== 0 && i % 0.5 !== 0) point.dataset.label = "";
                } else if (targetId === 'targetMonthlyGrowth') {
                    if (i <= 1.5) point.classList.add('status-low');
                    else if (i <= 3.0) point.classList.add('status-ideal');
                    else if (i <= 4.5) point.classList.add('status-high');
                    else point.classList.add('status-danger');
                    if (i % 1 !== 0) point.dataset.label = ""; 
                } else {
                    if (i === 1) point.classList.add('status-low');
                    else point.classList.add('status-ideal');
                }

                point.addEventListener('click', () => updateValue(i));
                pointsContainer.appendChild(point);
                
                if (i === max) break;
                if (i + step > max && i < max) { i = max - step; } 
            }

            function updateValue(val) {
                val = parseFloat(val);
                val = Math.max(min, Math.min(max, val));
                val = Math.round(val / step) * step;
                val = parseFloat(val.toFixed(2));

                slider.dataset.value = val;
                if (valueSpan) valueSpan.textContent = val.toFixed((targetId === 'targetMonthlyGrowth' || targetId === 'targetSize') ? 1 : 0);
                if (hiddenInput) {
                    hiddenInput.value = val;
                    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
                    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                const percent = ((val - min) / (max - min)) * 100;
                thumb.style.left = `calc(${percent}% - 12px)`;

                slider.querySelectorAll('.slider-point').forEach(p => {
                    const pVal = parseFloat(p.dataset.value);
                    p.classList.toggle('active', Math.abs(pVal - val) < 0.01);
                    p.classList.toggle('filled', pVal <= val + 0.01); // Eşit veya küçük olanlar dolu
                });

                if (targetId === 'dailyGoalHours') updateGoalFeedback();
                else if (targetId === 'targetMonthlyGrowth') updateGrowthFeedback();
                else if (targetId === 'targetSize') updateTargetFeedback();
                else updateCycleFeedback();
                
                dataManager.save();
            }

            if (!hasListeners) {
                // Drag/Swipe Support
                let isDragging = false;
                const handleDrag = (e) => {
                    const rect = slider.getBoundingClientRect();
                    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
                    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
                    const val = min + (percent / 100) * (max - min);
                    updateValue(val);
                };

                slider.addEventListener('mousedown', (e) => { isDragging = true; handleDrag(e); });
                window.addEventListener('mousemove', (e) => { if (isDragging) handleDrag(e); });
                window.addEventListener('mouseup', () => { isDragging = false; });
                
                slider.addEventListener('touchstart', (e) => { isDragging = true; handleDrag(e); }, {passive: false});
                slider.addEventListener('touchmove', (e) => { if (isDragging) { e.preventDefault(); handleDrag(e); } }, {passive: false});
                slider.addEventListener('touchend', () => { isDragging = false; });

                slider.dataset.initialized = "true";
            }

            // Global Access for refreshing (v2.0.2)
            slider.refreshSlider = () => updateValue(parseFloat(hiddenInput.value) || min);

            // Initial Sync
            slider.refreshSlider();
        });
    }

    function updateTargetFeedback() {
        const start = parseFloat(document.getElementById('startSize').value) || 0;
        const target = parseFloat(document.getElementById('targetSize').value) || 0;
        const age = parseInt(document.getElementById('userAge').value) || 30;
        const feedbackText = document.getElementById('targetFeedbackText');
        if (!feedbackText) return;

        const gain = target - start;
        let msg = "";
        let icon = "psychology";

        if (start === 0) {
            msg = "Lütfen önce başlangıç boyutunuzu girin.";
        } else if (gain <= 0) {
            msg = "Hedef boyut, başlangıç boyutundan büyük olmalıdır.";
            icon = "error";
        } else {
            // Base estimation (1 cm growth roughly 6-12 months)
            let baseMonths = gain * 8; // Average 8 months per cm
            
            // Age factor
            let ageMultiplier = 1;
            if (age > 40) ageMultiplier = 1.25;
            if (age > 55) ageMultiplier = 1.5;

            const estMonths = Math.round(baseMonths * ageMultiplier);
            const years = Math.floor(estMonths / 12);
            const remainingMonths = estMonths % 12;
            let timeStr = years > 0 ? `${years} yıl ${remainingMonths} ay` : `${remainingMonths} ay`;
            
            // Yaş faktörü açıklaması
            let ageNote = age > 40 ? `<br><small style="opacity:0.7; font-size: 0.85em;">* Yaşınıza bağlı doku yenilenme hızı (hücre analiz faktörü) süreye dahil edilmiştir.</small>` : "";

            if (gain <= 1.5) {
                msg = `<strong>Gerçekçi Hedef:</strong> ${gain.toFixed(1)} cm kazanım için tahmini süre: <strong>${timeStr}</strong>. Bu hedef, disiplinli bir çalışmayla ulaşılabilir düzeydedir. ${ageNote}`;
                icon = "verified";
            } else if (gain <= 3.0) {
                msg = `<strong>Hırslı Hedef:</strong> ${gain.toFixed(1)} cm kazanım için tahmini süre: <strong>${timeStr}</strong>. Bu seviye yüksek sabır ve kusursuz bir döngü disiplini gerektirir. ${ageNote}`;
                icon = "workspace_premium";
            } else if (gain <= 4.0) {
                msg = `<strong>Uç Hedef / Maraton:</strong> ${gain.toFixed(1)} cm kazanım için tahmini süre: <strong>${timeStr}+</strong>. Bu hedefe ulaşmak genetik limitleri zorlamak anlamına gelir. Çok uzun yıllar sürecek bir maratondur. ${ageNote}`;
                icon = "military_tech";
            } else {
                msg = `<strong>BİYOLOJİK LİMİT:</strong> ${gain.toFixed(1)} cm kazanım, cerrahi müdahale olmadan doğal yollarla (traksiyon) ulaşılması neredeyse imkansız olan bir 'teorik limit' değeridir. ${ageNote}`;
                icon = "warning";
            }
        }

        feedbackText.innerHTML = msg;
        const box = document.getElementById('targetFeedback');
        if (box) {
            const iconEl = box.querySelector('.material-symbols-outlined');
            if (iconEl) iconEl.textContent = icon;
        }
    }

    // Başlangıç boyutu veya yaş değiştiğinde analizi ve slider noktalarını tazele
    document.getElementById('startSize').addEventListener('change', () => {
        initSmartCycleSliders(); // Re-init to update point colors
        updateTargetFeedback();
    });

    document.getElementById('userAge').addEventListener('change', () => {
        const age = parseInt(document.getElementById('userAge').value) || 30;
        const growthSlider = document.getElementById('slider-targetMonthlyGrowth');
        
        // Yaşa göre ideal beklentiyi otomatik öner
        let suggestedGrowth = 2.0;
        if (age > 40 && age <= 55) suggestedGrowth = 1.5;
        if (age > 55) suggestedGrowth = 1.0;

        // Slider'ı güncelle (varsa updateValue fonksiyonunu tetiklemek için)
        // targetMonthlyGrowth slider'ının kendi updateValue'sunu bulup çalıştırmalıyız
        // Basitçe hidden inputu güncelleyip slider'ı re-init edebiliriz veya manuel tetikleriz
        const hiddenGrowth = document.getElementById('targetMonthlyGrowth');
        if (hiddenGrowth) {
            hiddenGrowth.value = suggestedGrowth;
            // initSmartCycleSliders içindeki setTimeout initial sync'i tetikleyecektir
            initSmartCycleSliders(); 
        }
        
        updateTargetFeedback();
        updateGrowthFeedback();
    });

    function updateGrowthFeedback() {
        const mm = parseFloat(document.getElementById('targetMonthlyGrowth').value) || 2;
        const age = parseInt(document.getElementById('userAge').value) || 30;
        const feedbackText = document.getElementById('growthFeedbackText');
        if (!feedbackText) return;

        let msg = "";
        let icon = "insights";
        
        // Yaş Grubu Tanımı
        let ageGroup = "genç";
        if (age > 40) ageGroup = "orta";
        if (age > 55) ageGroup = "olgun";

        // Yaşa Göre İdeal Aralığı Belirle
        let idealMin = 2.0;
        let idealMax = 3.0;
        let ageAdvice = "";
        
        if (ageGroup === "genç") {
            idealMin = 2.0; idealMax = 3.0;
            ageAdvice = "Hücre yenilenme hızınız yüksek, ayda 2-3 mm arası gelişim oldukça gerçekçidir.";
        } else if (ageGroup === "orta") {
            idealMin = 1.5; idealMax = 2.5;
            ageAdvice = "Doku elastikiyeti dengelidir, ayda 1.5-2.5 mm arası istikrarlı bir ilerleme hedeflenmelidir.";
        } else {
            idealMin = 1.0; idealMax = 2.0;
            ageAdvice = "Doku onarımı daha fazla sabır gerektirir, ayda 1-2 mm arası gelişim sizin yaş grubunuz için mükemmel bir başarıdır.";
        }

        let agePrefix = `<div style="margin-bottom: 8px; font-size: 0.9em; color: var(--accent-color); font-weight: bold; display: flex; align-items: center; gap: 5px;"><span class="material-symbols-outlined" style="font-size: 16px;">biotech</span> Yaş Analizi (${age} Yaş)</div>`;

        if (mm < idealMin) {
            msg = `<strong>Muhafazakar Yaklaşım:</strong> Ayda ${mm} mm gelişim seçildi. Bu hız, yaşınıza göre oldukça güvenli ve sürdürülebilir bir tempodur. Dokuların yorulmasını önler.`;
            icon = "trending_up";
        } else if (mm >= idealMin && mm <= idealMax) {
            msg = `<strong>İdeal Hedef:</strong> ${mm} mm gelişim, ${age} yaş grubu için en verimli ve sağlıklı aralıktır. ${ageAdvice}`;
            icon = "check_circle";
        } else if (mm > idealMax && mm <= idealMax + 1.5) {
            msg = `<strong>Zorlayıcı Hedef:</strong> Ayda ${mm} mm gelişim, yaşınıza göre yüksek bir beklentidir. Bu hıza ulaşmak için seans sürelerini artırmanız ve beslenmenize (protein/kolajen) dikkat etmeniz gerekir.`;
            icon = "bolt";
        } else {
            msg = `<strong>Ütopik Beklenti:</strong> Ayda ${mm} mm gelişim bilimsel sınırların oldukça üzerindedir. Motivasyonunuzun kırılmaması için hedefi biraz daha makul seviyelere (örn: ${idealMax} mm) çekmenizi öneririm.`;
            icon = "auto_awesome";
        }

        feedbackText.innerHTML = agePrefix + msg;
        const box = document.getElementById('growthFeedback');
        if (box) {
            const iconEl = box.querySelector('.material-symbols-outlined');
            if (iconEl) iconEl.textContent = icon;
        }
    }

    function updateGoalFeedback() {
        const hours = parseInt(document.getElementById('dailyGoalHours').value) || 6;
        const feedbackText = document.getElementById('goalFeedbackText');
        if (!feedbackText) return;

        let msg = "";
        let icon = "analytics";

        if (hours <= 3) {
            msg = "<strong>Düşük Hedef:</strong> Günde " + hours + " saat kullanım, doku genişlemesini tetiklemek için yetersiz kalabilir. İdeal sonuçlar için en az 4-6 saat önerilir.";
            icon = "trending_down";
        } else if (hours >= 4 && hours <= 8) {
            msg = "<strong>İdeal Hedef:</strong> Günde " + hours + " saatlik kullanım, dokuların sağlıklı bir şekilde genişlemesi ve onarılması için mükemmel bir süredir.";
            icon = "check_circle";
        } else if (hours >= 9 && hours <= 11) {
            msg = "<strong>Yüksek Yoğunluk:</strong> " + hours + " saatlik kullanım üst sınıra yakındır. Cilt hassasiyetini yakından takip etmelisin.";
            icon = "speed";
        } else {
            msg = "<strong>ÜST SINIR:</strong> 12 saatlik kullanım en yüksek güvenlik sınırıdır. Bu sürenin üzerine çıkılması doku sağlığı açısından önerilmez.";
            icon = "report_problem";
        }

        feedbackText.innerHTML = msg;
        const box = document.getElementById('goalFeedback');
        if (box) {
            const iconEl = box.querySelector('.material-symbols-outlined');
            if (iconEl) iconEl.textContent = icon;
        }
    }

    function updateCycleFeedback() {
        const work = parseInt(document.getElementById('workCycleDays').value) || 5;
        const rest = parseInt(document.getElementById('restCycleDays').value) || 2;
        const feedbackText = document.getElementById('cycleFeedbackText');
        if (!feedbackText) return;

        let msg = "";
        let icon = "info";

        if (work <= 3) {
            msg = "<strong>Düşük Yoğunluk:</strong> " + work + " günlük çalışma, doku genişlemesi tetiklemek için yetersiz kalabilir. İdeal verim için 4-6 gün önerilir.";
            icon = "warning";
        } else if (work >= 8 && work <= 9) {
            msg = "<strong>Yüksek Yoğunluk:</strong> " + work + " gün üst üste çalışma dokuları yorabilir. Hassasiyet veya ereksiyon kalitesini takip etmelisin.";
            icon = "shutter_speed";
        } else if (work >= 10) {
            msg = "<strong>RİSKLİ BÖLGE:</strong> 10 gün ve ötesi aralıksız çalışma doku hasarı riskini artırır. MUTLAKA dinlenme arası vermelisin!";
            icon = "report_problem";
        } else {
            msg = "<strong>İdeal Çalışma:</strong> " + work + " günlük çalışma periyodu, istikrarlı gelişim için mükemmeldir.";
            icon = "check_circle";
        }

        msg += "<br><br>";

        if (rest === 1) {
            msg += "<strong>Hızlı Onarım:</strong> 1 gün dinlenme 'minimum' seviyededir. Eğer yorgunluk hissediyorsan 2 güne çıkarmalısın.";
        } else {
            msg += "<strong>Tam Onarım:</strong> 2 günlük dinlenme, yeni oluşan dokuların kalıcılaşması (konsolidasyon) için en sağlıklı süredir.";
        }

        feedbackText.innerHTML = msg;
        const box = document.getElementById('cycleFeedback');
        if (box) {
            const iconEl = box.querySelector('.material-symbols-outlined');
            if (iconEl) iconEl.textContent = icon;
        }
    }

    function updateTimerFeedback() {
        const dur = parseInt(document.getElementById('timerDuration')?.value) || 120;
        const brk = parseInt(document.getElementById('timerBreak')?.value) || 30;
        const feedbackText = document.getElementById('timerFeedbackText');
        const feedbackIcon = document.getElementById('timerFeedbackIcon');
        if (!feedbackText || !feedbackIcon) return;

        let msg = "";
        let icon = "info";

        // Seans Süresi Kontrolü
        if (dur < 60) {
            msg += "<strong>Yetersiz Seans:</strong> " + dur + " dakikalık süre kalıcı esneme (plastik deformasyon) için çok kısadır. Etki görmek için en az 60 dk (tercihen 120+ dk) önerilir.<br><br>";
            icon = "warning";
        } else if (dur >= 60 && dur <= 180) {
            msg += "<strong>İdeal Seans:</strong> " + dur + " dakikalık süre hücre bölünmesi tetiklemek için altın standarttır.<br><br>";
            if (icon !== "warning") icon = "check_circle";
        } else {
            msg += "<strong>Tehlikeli Seans:</strong> " + dur + " dakikalık aralıksız süre çok uzun! Doku hasarı, su toplaması ve kan dolaşımı sorunları (iskemi) riski çok yüksektir.<br><br>";
            icon = "report_problem";
        }

        // Mola Süresi Kontrolü
        if (brk < 15) {
            msg += "<strong>Kısa Mola:</strong> " + brk + " dk mola, kan akışının normale dönmesi için yetersiz olabilir. En az 15 dk önerilir.";
            if (icon !== "report_problem") icon = "warning";
        } else if (brk >= 15 && brk <= 45) {
            msg += "<strong>Sağlıklı Mola:</strong> " + brk + " dk mola, doku onarımı ve taze kan akışı için mükemmeldir.";
        } else {
            msg += "<strong>Uzun Mola:</strong> " + brk + " dk mola uzun. Dokular soğuyarak esnekliğini kaybedebilir, sonraki seansa başlarken zorlanabilirsiniz.";
            if (icon !== "report_problem") icon = "warning";
        }

        feedbackText.innerHTML = msg;
        feedbackIcon.textContent = icon;
    }

    // Initialize Smart Cycle Sliders
    initSmartCycleSliders();

    // --- UNIVERSAL STEPPER LOGIC ---
    // (Note: .btn-stepper logic remains for any remaining buttons if any, 
    // but the inputs themselves are now interactive)
    document.querySelectorAll('.btn-stepper').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const inputId = btn.getAttribute('data-input');
            const delta = parseFloat(btn.getAttribute('data-delta'));
            const input = document.getElementById(inputId);
            if (!input) return;

            let val = parseFloat(input.value) || 0;
            val += delta;

            // Constraints & Precision
            if (inputId === 'inputMinutes') {
                if (val < 0) val = 0;
                if (val > 59) val = 59;
            } else if (inputId.toLowerCase().includes('size') || inputId.toLowerCase().includes('tension') || inputId.toLowerCase().includes('growth')) {
                if (val < 0) val = 0;
                val = Math.round(val * 10) / 10; // 0.1 decimal precision
            } else {
                if (val < 0) val = 0;
            }
            
            input.value = val;
            
            // Trigger events for other listeners
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    // --- DUAL STEPPER LOGIC (New Design) ---
    // Handle box selection (Count vs Duration)
    document.querySelectorAll('.dual-box').forEach(box => {
        box.addEventListener('click', () => {
            const container = box.closest('.dual-stepper-container');
            if (!container || container.classList.contains('single') || container.classList.contains('time-stepper-full')) return;

            container.querySelectorAll('.dual-box').forEach(b => b.classList.remove('active'));
            box.classList.add('active');
        });
    });

    // Handle shared controls
    document.querySelectorAll('.btn-dual-stepper').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const container = btn.closest('.dual-stepper-container');
            const activeBox = container.querySelector('.dual-box.active');
            if (!activeBox) return;

            const inputId = activeBox.getAttribute('data-target');
            let delta = parseFloat(btn.getAttribute('data-delta'));
            const input = document.getElementById(inputId);
            if (!input) return;

            // Timer duration için 10'ar, giriş dakikası için 5'er dakikalık adımlar
            if (inputId === 'timerDuration' && Math.abs(delta) === 1) {
                delta *= 10;
            } else if (inputId === 'inputMinutes' && Math.abs(delta) === 1) {
                delta *= 5;
            }

            let val = parseFloat(input.value) || 0;
            val += delta;

            // Constraints
            if (val < 1 && !['timerBreak', 'inputHours', 'inputMinutes', 'editHours', 'editMinutes'].includes(inputId)) val = 1;
            if (val < 0) val = 0;
            if (inputId === 'timerCount' && val > 10) val = 10;
            
            input.value = val;

            // Trigger events
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    // Universal Auto-clear "0" on focus for all number inputs
    document.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
            if (e.target.value === '0') e.target.value = '';
        }
    });
    document.addEventListener('focusout', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
            if (e.target.value === '') e.target.value = '0';
        }
    });

    // --- UPDATE STATUS CHECK ---
    function checkUpdateStatus() {
        if (sessionStorage.getItem('app_just_updated') === 'true') {
            sessionStorage.removeItem('app_just_updated');
            // Ayarlar sekmesine geç
            if (typeof switchView === 'function') switchView('settings');

            const verText = document.getElementById('appVersionText');
            if (verText) {
                const originalText = verText.textContent;
                verText.style.color = '#2ecc71'; // Yeşil renk
                verText.style.fontWeight = '700';
                verText.textContent = '✅ Uygulamanız v2.4.1 sürümüne güncellendi!';
                
                setTimeout(() => {
                    verText.style.color = '';
                    verText.style.fontWeight = '';
                    verText.textContent = originalText;
                }, 5000);
            }
        }
    }

    // Init App
    // Varsayılan olarak Seans Modu ile başla
    localStorage.setItem('timer_entry_mode', 'timer');
    const card = document.getElementById('timerCard');
    if (card) {
        card.classList.remove('is-manual-view', 'mode-manual');
        const icon = document.querySelector('#btnToggleManual span');
        if (icon) icon.textContent = 'edit_calendar';
    }

    renderRulerScale();
    updateSettingsView();
    updateHomeView();
    checkUpdateStatus();
    if (dataManager.data.activeSessionState && dataManager.data.activeSessionState.mode !== 'ready') startTimerUI();
    
    // UI Durumunu Senkronize Et
    updateTimerDisplay();

    // --- MANUEL SAYAÇ: SWIPE, WHEEL & TAP ETKİLEŞİMİ ---
    (function initManualStepperSwipe() {
        const boxes = document.querySelectorAll('.dual-box[data-target], .modern-stepper-container');

        boxes.forEach(box => {
            const input = box.querySelector('input') || document.getElementById(box.getAttribute('data-target'));
            if (!input) return;
            const inputId = input.id;

            // Dinamik sınırlar ve adımlar
            let maxVal = parseFloat(input.getAttribute('max')) || 999;
            let step = parseFloat(input.getAttribute('step')) || 1;
            
            // Özel Kurallar
            if (inputId === 'inputMinutes' || inputId === 'editMinutes') { maxVal = 55; step = 5; }
            if (inputId === 'inputHours' || inputId === 'editHours') { maxVal = 12; step = 1; }
            if (inputId === 'timerCount') { maxVal = 10; step = 1; }
            if (inputId === 'timerDuration') { maxVal = 360; step = 5; }
            if (inputId === 'timerBreak') { maxVal = 120; step = 5; }

            const PX_PER_STEP = 15; // Hassasiyet: Her 15px harekette bir adım
            let startY = 0, lastY = 0, isDragging = false, accumulated = 0;
            let interactionTimer = null;

            function setInteracting() {
                box.classList.add('is-interacting');
                if (interactionTimer) clearTimeout(interactionTimer);
            }

            function clearInteracting() {
                interactionTimer = setTimeout(() => box.classList.remove('is-interacting'), 300);
            }

            function changeBy(delta, wrap = false) {
                const current = parseFloat(input.value) || 0;
                let v = current + delta;
                
                let minVal = (inputId === 'timerCount' || inputId === 'timerDuration' || inputId === 'timerBreak') ? 1 : 0;
                
                if (wrap) {
                    if (v > maxVal) v = minVal;
                    else if (v < minVal) v = maxVal;
                } else {
                    v = Math.max(minVal, Math.min(maxVal, v));
                }
                
                // Hassas küsurat düzeltme (örn: 10.5 + 0.1 = 10.6)
                if (step < 1) v = Math.round(v * 10) / 10;
                
                input.value = v;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            function onStart(y) {
                startY = y; lastY = y;
                isDragging = false; accumulated = 0;
                setInteracting();
            }

            function onMove(y) {
                const dy = lastY - y; 
                lastY = y;
                if (Math.abs(y - startY) > 5) isDragging = true;
                if (!isDragging) return;

                setInteracting();
                accumulated += dy;
                while (accumulated >= PX_PER_STEP)  { changeBy(step);  accumulated -= PX_PER_STEP; }
                while (accumulated <= -PX_PER_STEP) { changeBy(-step); accumulated += PX_PER_STEP; }
            }

            function onEnd() {
                if (!isDragging) {
                    // Tıklayınca wrap (başa dönme) aktif olsun
                    changeBy(step, true);
                }
                isDragging = false; accumulated = 0;
                clearInteracting();
            }

            // Dokunmatik (Mobil)
            box.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
            box.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientY); },  { passive: false });
            box.addEventListener('touchend',   e => { e.preventDefault(); onEnd(); },                       { passive: false });

            // Masaüstü: Tıklama = +step
            box.addEventListener('click', e => {
                e.preventDefault();
                setInteracting();
                onEnd(); 
            });

            // Masaüstü: Tekerlek = ±step
            let lastWheelTime = 0;
            box.addEventListener('wheel', e => {
                e.preventDefault();
                e.stopPropagation();
                
                const now = Date.now();
                if (now - lastWheelTime < 50) return; // Debounce: Bazı fareler tek tıkta 2 event atabiliyor
                lastWheelTime = now;

                setInteracting();
                changeBy(e.deltaY < 0 ? step : -step);
                clearInteracting();
            }, { passive: false });

            // Input'un kendi scroll davranışını kapat (v2.1.7)
            input.addEventListener('wheel', e => e.preventDefault(), { passive: false });
        });
    })();


    // --- POMPA SÜRESİ: TIKLA (+1) & TEKERLEK (±5) ---
    (function initPumpDurationInteraction() {
        const display = document.getElementById('pumpTimerDisplay');
        const input = document.getElementById('pumpDuration');
        if (!display || !input) return;

        function clamp(val) { return Math.max(1, Math.min(60, val)); }
        function changeBy(delta) {
            if (pumpEndTime > 0) return; // Çalışırken düzenleme kapalı
            input.value = clamp((parseInt(input.value) || 15) + delta);
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        display.addEventListener('click', e => { e.preventDefault(); changeBy(1); });
        display.addEventListener('wheel', e => {
            e.preventDefault();
            changeBy(e.deltaY < 0 ? 5 : -5);
        }, { passive: false });

        // Mobil: parmakla kaydır
        let startY = 0, isDragging = false, accumulated = 0;
        display.addEventListener('touchstart', e => { 
            if (pumpEndTime > 0) return;
            e.preventDefault(); 
            startY = e.touches[0].clientY; isDragging = false; accumulated = 0; 
        }, { passive: false });
        
        display.addEventListener('touchmove', e => {
            if (pumpEndTime > 0) return;
            e.preventDefault();
            const dy = startY - e.touches[0].clientY;
            if (Math.abs(dy) > 5) isDragging = true;
            accumulated += (startY - e.touches[0].clientY);
            startY = e.touches[0].clientY;
            while (accumulated >= 10)  { changeBy(5);  accumulated -= 10; }
            while (accumulated <= -10) { changeBy(-5); accumulated += 10; }
        }, { passive: false });
        
        display.addEventListener('touchend', e => { 
            if (pumpEndTime > 0) return;
            e.preventDefault(); 
            if (!isDragging) changeBy(1); 
        }, { passive: false });
    })();

    // --- VIDA BOYUTU REHBERİ (PAGINATION) ---
    (function initTensionPagination() {
        const dots = document.querySelectorAll('.page-dot');
        const text = document.getElementById('tensionFeedbackText');
        if (!dots.length || !text) return;

        const pages = {
            "1": "<strong>Rehber (1/3):</strong> Vida boyutu, dokulara uygulanan gerilimi belirler. Her hafta 0.5 - 1 mm arası artış, doku hasarı riskini minimize ederken en istikrarlı gelişimi sağlar.",
            "2": "<strong>Rehber (2/3):</strong> Ne zaman artırmalı? Mevcut gerilim artık hissedilmediğinde veya seans sonunda dokular tamamen esnek kaldığında vidayı 1 mm artırabilirsiniz.",
            "3": "<strong>Rehber (3/3):</strong> Güvenlik: Eğer acı, uyuşma veya deride renk değişimi varsa vidayı sabit tutun veya 1-2 mm geri çekerek dokuları birkaç gün dinlendirin."
        };

        dots.forEach(dot => {
            dot.addEventListener('click', () => {
                const pageNum = dot.getAttribute('data-page');
                
                // Update UI
                dots.forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                
                // Update Text with simple animation
                text.style.opacity = '0';
                setTimeout(() => {
                    text.innerHTML = pages[pageNum];
                    text.style.opacity = '1';
                }, 150);
            });
        });
    })();

    // Desktop Scroll Delegation (v2.1.7)
    // Allows desktop users to scroll the app even when hovering outside the 480px container
    window.addEventListener('wheel', (e) => {
        // If hovered directly over the body/html background (the dark empty space)
        if (e.target === document.body || e.target === document.documentElement) {
            const content = document.querySelector('.view.active')?.closest('.content') || document.querySelector('.content');
            if (content) {
                content.scrollTop += e.deltaY;
            }
        }
    }, { passive: true });
});
