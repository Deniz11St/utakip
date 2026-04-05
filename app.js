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
            geminiApiKey: '',
            geminiModelName: 'gemini-3-flash-preview',
            dailyGoalHours: 6,
            timerSettings: {
                count: 3,
                duration: 120, // mins
                break: 30, // mins
                sound: true,
                vibrate: true
            },
            activeSessionState: {
                current: 1,
                mode: 'ready', // 'ready', 'work', 'break'
                startTime: 0,
                lastModeChange: 0
            }
        };
        const raw = localStorage.getItem('uTakipData');
        this.data = raw ? JSON.parse(raw) : defaultData;
        if (!this.data.monthlyTension) this.data.monthlyTension = {};
        if (!this.data.monthlySize) this.data.monthlySize = {};
        if (!this.data.notes) this.data.notes = {};
        if (!this.data.coachChat) this.data.coachChat = [];
        if (!this.data.geminiApiKey) this.data.geminiApiKey = '';
        if (!this.data.geminiModelName) this.data.geminiModelName = 'gemini-3-flash-preview';
        if (this.data.targetMonthlyGrowth === undefined) this.data.targetMonthlyGrowth = 2;
        if (this.data.dailyGoalHours === undefined) this.data.dailyGoalHours = 6;
        if (this.data.timerStartTime === undefined) this.data.timerStartTime = 0;
        
        if (this.data.timerSettings === undefined) {
            this.data.timerSettings = { count: 3, duration: 120, break: 30, sound: true, vibrate: true };
        }
        if (this.data.activeSessionState === undefined) {
            this.data.activeSessionState = { current: 1, mode: 'ready', startTime: 0, lastModeChange: 0 };
        }
        
        // MIGRATION: Eskiden sadece dakika tutulan arrayleri (number array), objeye {mins: X, diff: 'normal'} dönüştürür.
        if (this.data.sessions) {
            Object.keys(this.data.sessions).forEach(k => {
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

    save() {
        localStorage.setItem('uTakipData', JSON.stringify(this.data));
    }

    // Setters
    setBaseSettings(name, age, date, size, target, growthRate, apiKey = '', modelName = 'gemini-3-flash-preview', dailyGoal = 6) {
        this.data.name = name;
        this.data.age = parseInt(age) || 0;
        this.data.startDate = date;
        
        const parsedSize = parseFloat(size);
        const oldStartSize = this.data.startSize;
        this.data.startSize = isNaN(parsedSize) ? 0 : parsedSize;
        
        if (!this.data.currentSize || this.data.currentSize === oldStartSize) {
            this.data.currentSize = this.data.startSize;
        }

        this.data.geminiApiKey = apiKey.trim();
        this.data.geminiModelName = modelName.trim() || 'gemini-3-flash-preview';
        this.data.dailyGoalHours = parseFloat(dailyGoal) || 6;
        
        if(target && !isNaN(parseFloat(target))) {
            this.data.targetSize = parseFloat(target);
        }
        if(growthRate && !isNaN(parseFloat(growthRate))) {
            this.data.targetMonthlyGrowth = parseFloat(growthRate);
        }
        this.save();
    }

    setCurrentData(size, tension) {
        const today = new Date();
        const currentYYYYMM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        
        if(size) {
            this.data.currentSize = parseFloat(size);
            if (!this.data.monthlySize) this.data.monthlySize = {};
            this.data.monthlySize[currentYYYYMM] = parseFloat(size);
        }
        if(tension) {
            this.data.monthlyTension[currentYYYYMM] = parseFloat(tension);
        }
        this.save();
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

    addJournalNote(dateStr, noteObj) {
        if (!this.data.notes) this.data.notes = {};
        if (!this.data.notes[dateStr]) this.data.notes[dateStr] = [];
        
        // Eğer noteObj bir string ise objeye çevir
        const structuredNote = typeof noteObj === 'string' ? { note: noteObj } : noteObj;
        
        // Aynı günün verisi varsa üzerine yazmak yerine listeye ekle (veya günün tek bir ana günlüğü varsa güncelle)
        // Kullanıcı deneyimi için günlük notları listeleniyor.
        this.data.notes[dateStr].push({
            timestamp: Date.now(),
            ...structuredNote
        });
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
document.addEventListener('DOMContentLoaded', () => {
    const dataManager = new TrackerData();

    // Tab Navigation Switcher
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            switchView(target);
        });
    });

    function switchView(target) {
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
    }

    // Home Page Journal Button
    document.getElementById('btnHomeOpenJournal')?.addEventListener('click', () => {
        switchView('journal');
    });

    // Journal Back Button
    document.getElementById('btnJournalBack')?.addEventListener('click', () => {
        switchView('home');
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
            
            if (isCm) {
                tTick.style.scrollSnapAlign = 'center';
            }
            
            // i=5 noktası gerçek başlangıç CM (startCm) değeridir.
            // Bu yüzden val ofsetli hesaplanır:
            let mmRelative = i - 5;
            let currentValCm = startCm + (mmRelative / 10);

            if (isMajor) {
                let displayVal = currentValCm % 1 === 0 ? currentValCm : currentValCm.toFixed(1);
                const numberEl = document.createElement('div');
                numberEl.className = 'ruler-floating-number';
                numberEl.textContent = displayVal + ' mm';
                tTick.appendChild(numberEl);
                
                tTick.style.cursor = 'pointer';
                const closureVal = currentValCm;
                tTick.onclick = () => { if (window.showPointEstimate) window.showPointEstimate(closureVal); };
            }
            
            // Başlangıç Bayrağı (🚩) - i=5 tam startCm konumudur
            if (i === 5) {
                const flag = document.createElement('div');
                flag.textContent = '🚩';
                flag.className = 'ruler-target-flag'; // Aynı stil kullanılabilir
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


    function updateHomeView() {
        // Display Start Date
        const displayDate = document.getElementById('displayStartDate');
        if (dataManager.data.startDate) {
            const d = new Date(dataManager.data.startDate);
            displayDate.textContent = d.toLocaleDateString('tr-TR');
        } else {
            displayDate.textContent = 'Ayarlanmadı';
        }

        // Update Target Estimate
        const displayTargetInfo = document.getElementById('displayTargetInfo');
        if (dataManager.data.targetSize && dataManager.data.targetSize > 0) {
            displayTargetInfo.style.display = 'block';
            document.getElementById('displayTargetSize').textContent = dataManager.data.targetSize.toFixed(1);
            
            let rate = dataManager.data.targetMonthlyGrowth > 0 ? dataManager.data.targetMonthlyGrowth : 2;
            
            let baseSize = dataManager.data.currentSize > 0 ? dataManager.data.currentSize : dataManager.data.startSize;
            let remainingCm = dataManager.data.targetSize - baseSize;
            
            const estEl = document.getElementById('displayEstimate');
            if (remainingCm <= 0) {
                estEl.textContent = 'Hedefe Ulaşıldı!';
            } else {
                let monthsNeeded = Math.ceil((remainingCm * 10) / rate); 
                const estDate = new Date();
                estDate.setMonth(estDate.getMonth() + monthsNeeded);
                estEl.textContent = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(estDate);
            }
        } else {
            if(displayTargetInfo) displayTargetInfo.style.display = 'none';
        }

        // Update Coach
        const coachMsgEl = document.getElementById('coachMessage');
        coachMsgEl.innerHTML = generateCoachAdvice();
        
        // Coach card click to go to library
        const coachCard = document.querySelector('.coach-card');

        // Update Thermometer
        const stage = dataManager.getStage();
        
        const startCm = dataManager.data.startSize;
        const targetCm = dataManager.data.targetSize > 0 ? dataManager.data.targetSize : startCm + 5;
        
        // Cetveli tek bir upuzun bant olarak render ediyoruz
        const totalMm = renderRulerScale(startCm, targetCm);

        // Tarih Tahminleri Hesaplama
        const estMidEl = document.getElementById('estMid');
        const estEndEl = document.getElementById('estEnd');
        
        // Global bir timer referansı tutarak çakışmaları önleyelim
        if (!window.rulerTimer) window.rulerTimer = null;

        const dateOpts = { day: '2-digit', month: 'long', year: 'numeric' };

        // Bir sonraki iki hedefi hesaplayan fonksiyon (Kullanıcının isteği: 5mm'lik sıradaki iki hedef)
        function updateDefaultEstimates() {
            if (dataManager.data.startDate && dataManager.data.targetMonthlyGrowth > 0) {
                const startDate = new Date(dataManager.data.startDate);
                const rate = dataManager.data.targetMonthlyGrowth;
                const currentSize = dataManager.data.currentSize || dataManager.data.startSize;
                
                // Sıradaki ilk 5mm'lik hedef (örn: 16.2 ise 16.5, 16.5 ise 17.0)
                const next1Cm = (Math.floor(currentSize * 2) + 1) / 2;
                const next2Cm = next1Cm + 0.5;
                
                const mmDiff1 = Math.round((next1Cm - dataManager.data.startSize) * 10);
                const mmDiff2 = Math.round((next2Cm - dataManager.data.startSize) * 10);
                
                const date1 = new Date(startDate);
                date1.setDate(date1.getDate() + (mmDiff1 / rate) * 30.4375);
                
                const date2 = new Date(startDate);
                date2.setDate(date2.getDate() + (mmDiff2 / rate) * 30.4375);
                
                estMidEl.innerHTML = `🎯 Sıradaki Hedef (<b>${next1Cm.toFixed(1)} cm</b>): ${date1.toLocaleDateString('tr-TR', dateOpts)}`;
                estEndEl.innerHTML = `🏆 Sonraki Hedef (<b>${next2Cm.toFixed(1)} cm</b>): ${date2.toLocaleDateString('tr-TR', dateOpts)}`;
            } else {
                estMidEl.textContent = 'Tahmini Orta Nokta: -';
                estEndEl.textContent = 'Tahmini Hedef Bitişi: -';
            }
        }

        // Tıklama yapıldığında geçici süreyle o noktanın bilgisini gösterir
        window.showPointEstimate = (targetCmValue) => {
            if (window.rulerTimer) clearTimeout(window.rulerTimer);
            
            const startDate = new Date(dataManager.data.startDate);
            const rate = dataManager.data.targetMonthlyGrowth;
            const mmDiff = Math.max(0, Math.round((targetCmValue - dataManager.data.startSize) * 10));
            
            const targetDate = new Date(startDate);
            targetDate.setDate(targetDate.getDate() + (mmDiff / rate) * 30.4375);
            
            estMidEl.innerHTML = `🔍 <b>${targetCmValue.toFixed(1)} cm</b> Sorgusu: ${targetDate.toLocaleDateString('tr-TR', dateOpts)}`;
            estEndEl.innerHTML = `<span style="opacity: 0.5;">(Tahmini varış süresidir)</span>`;
            
            window.rulerTimer = setTimeout(() => {
                updateDefaultEstimates();
            }, 3500);
        };

        // İlk yüklemede varsayılan hedefleri göster
        if (!window.rulerTimer) updateDefaultEstimates();

        // Kırmızı barı güncelle ve scroll ayarı yap
        // Dolgu cetvelin en başından (startCm - 0.5) güncel boyuta kadar olmalı
        const currentSize = dataManager.data.currentSize || dataManager.data.startSize;
        const scaleStartCm = startCm - 0.5;
        let growthMmRelativeToScale = (currentSize - scaleStartCm) * 10;
        
        if(growthMmRelativeToScale < 0) growthMmRelativeToScale = 0;
        if(growthMmRelativeToScale > totalMm) growthMmRelativeToScale = totalMm;
        
        const widthPercent = (growthMmRelativeToScale / totalMm) * 100;
        
        setTimeout(() => {
            const fill = document.getElementById('rulerFill');
            if(fill) fill.style.width = `${widthPercent}%`;
            
            const viewport = document.getElementById('rulerViewport');
            if (viewport) {
                // Scroll ofset: Stage başlangıcı + 5mm tampon
                let scrollStageMm = (stage > 0 ? (stage - 1) * 10 : 0) + 5;
                const scrollWidth = viewport.scrollWidth;
                const pxPerMm = scrollWidth / totalMm;
                
                viewport.scrollTo({
                    left: scrollStageMm * pxPerMm,
                    behavior: 'smooth'
                });
            }
        }, 150);

        // Daily Work Goal Update
        const dailyMins = dataManager.getTodayMinutes();
        const goalHours = dataManager.data.dailyGoalHours || 6;
        const goalMins = goalHours * 60;
        const dailyPercent = Math.min((dailyMins / goalMins) * 100, 100); 
        const dailyFill = document.getElementById('dailyProgressFill');
        const dailyText = document.getElementById('dailyTimeText');
        const dailyGoalLabel = document.getElementById('dailyGoalLabel');
        const dailyGoalEndLabel = document.getElementById('dailyGoalEndLabel');

        if (dailyFill && dailyText) {
            const h = Math.floor(dailyMins / 60);
            const m = dailyMins % 60;
            dailyText.textContent = `${h}s ${m}dk`;
            if (dailyGoalLabel) dailyGoalLabel.textContent = goalHours;
            if (dailyGoalEndLabel) dailyGoalEndLabel.textContent = `${goalHours}s+`;

            // Color logic (Orantısal geçişler)
            let color = '#ffffff'; // 0 - 25% hedef: Beyaz
            if (dailyMins >= goalMins * 0.75) color = '#bb86fc';      // %75+: Mor (Excellent)
            else if (dailyMins >= 240) color = '#2ecc71';            // 4 saat: Yeşil (Sabit uzman barajı)
            else if (dailyMins >= 120) color = '#f39c12';            // 2 saat: Turuncu (Gelişim)

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

        // Update Chart (Anasayfaya taşındı)
        updateChartView();
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
        const currentYYYYMM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        monthSet.add(currentYYYYMM);

        Object.keys(dataManager.data.sessions).forEach(dateStr => {
            monthSet.add(dateStr.substring(0, 7));
        });

        const sortedMonths = Array.from(monthSet).sort((a, b) => b.localeCompare(a));

        sortedMonths.forEach(yearMonth => {
            const [yStr, mStr] = yearMonth.split('-');
            const y = parseInt(yStr);
            const m = parseInt(mStr) - 1;
            
            const accordionItem = document.createElement('div');
            accordionItem.className = 'accordion-item';

            const headerCard = document.createElement('div');
            headerCard.className = 'card accordion-header';
            if (yearMonth === currentYYYYMM) headerCard.classList.add('open');
            
            const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(y, m));
            const h3 = document.createElement('h3');
            h3.textContent = `${monthName} Takvimi`;
            headerCard.appendChild(h3);

            const daysInMonth = new Date(y, m + 1, 0).getDate();
            let monthTotalMins = 0;
            const daysHTMLArray = [];

            for (let i = 1; i <= daysInMonth; i++) {
                const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                const sessions = dataManager.data.sessions[dateStr] || [];
                
                // Show empty days only for the current month. Past months show recorded days only.
                if (sessions.length > 0 || yearMonth === currentYYYYMM) {
                    let dailyTotalMins = 0;
                    
                    const dayRow = document.createElement('div');
                    dayRow.className = 'day-row';
                    
                    const dateCol = document.createElement('div');
                    dateCol.className = 'day-date';
                    dateCol.style = "display: flex; align-items: center; gap: 4px;";
                    dateCol.innerHTML = `<span>${i}</span>`;
                    
                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn-day-edit';
                    editBtn.innerHTML = '<span class="material-symbols-outlined">edit_calendar</span>';
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        openEditModal(dateStr);
                    };
                    dateCol.appendChild(editBtn);
                    dayRow.appendChild(dateCol);
                    
                    const sessionsCol = document.createElement('div');
                    sessionsCol.className = 'day-sessions';
                    
                    for(let s=0; s<5; s++) {
                        if (s < sessions.length) {
                            const sessionObj = sessions[s];
                            const mins = sessionObj.mins || 0;
                            dailyTotalMins += mins;
                            
                            const box = document.createElement('div');
                            box.className = 'session-box';
                            const diffIcon = sessionObj.diff === 'rahat' ? '🟢' : (sessionObj.diff === 'zor' ? '🔴' : '🟡');
                            box.innerHTML = `
                                <div style="display:flex; align-items:center; justify-content:center; gap:4px; cursor:pointer;" title="Düzenle / Sil">
                                    <span>${mins} dk</span>
                                    <span style="font-size:11px">${diffIcon}</span>
                                    <span style="font-size:10px; opacity:0.5;">✏️</span>
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
                            empty.className = 'session-box';
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
                    totalCol.textContent = dailyTotalMins > 0 ? formatMinutes(dailyTotalMins) : '0 dk';
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
                <div class="stat-box">
                    <span class="stat-label">Aylık Çalışma</span>
                    <strong class="stat-value text-blue">${formatMinutes(monthTotalMins)}</strong>
                </div>
                ${tension ? `
                <div class="stat-box">
                    <span class="stat-label">Aylık Gerginlik</span>
                    <strong class="stat-value" style="color: #d2a8ff;">${tension.toFixed(1)} cm</strong>
                </div>
                ` : ''}
                ${monthlySize ? `
                <div class="stat-box">
                    <span class="stat-label">Aylık Uzama</span>
                    <strong class="stat-value text-green">${monthlyGrowth.toFixed(1)} mm</strong>
                </div>
                <div class="stat-box">
                    <span class="stat-label">Ay Sonu Boyutu</span>
                    <strong class="stat-value">${monthlySize.toFixed(2)} cm</strong>
                </div>
                ` : (yearMonth === currentYYYYMM ? `
                <div class="stat-box">
                    <span class="stat-label">Aylık Uzama</span>
                    <strong class="stat-value text-green">- mm</strong>
                </div>
                <div class="stat-box">
                    <span class="stat-label">Ay Sonu Boyutu</span>
                    <strong class="stat-value">- cm</strong>
                </div>
                ` : '')}
            `;
            statsDiv.innerHTML = statsHtml;
            headerCard.appendChild(statsDiv);
            
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'accordion-body calendar-days';
            if (yearMonth === currentYYYYMM) bodyDiv.classList.add('open');
            
            daysHTMLArray.forEach(el => bodyDiv.appendChild(el));

            // EĞER O AYIN NOTLARI VARSA EKLE
            const monthNotes = [];
            Object.keys(dataManager.data.notes).forEach(d => {
                if (d.startsWith(yearMonth)) {
                    monthNotes.push({ date: d, text: dataManager.data.notes[d] });
                }
            });

            if (monthNotes.length > 0) {
                const notesTitle = document.createElement('h4');
                notesTitle.style = "margin: 20px 0 10px 0; color: #a5d6ff; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 5px;";
                notesTitle.innerHTML = "📝 Ayın Notları";
                bodyDiv.appendChild(notesTitle);
                
                monthNotes.forEach(n => {
                    const noteDiv = document.createElement('div');
                    noteDiv.style = "font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; border-left: 2px solid #a5d6ff;";
                    const dNum = n.date.split('-')[2];
                    const noteMonthName = new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(new Date(y, m));
                    noteDiv.innerHTML = `<small style="display:block; opacity:0.6; margin-bottom:2px;">${dNum} ${noteMonthName}:</small> ${n.text.join(' | ')}`;
                    bodyDiv.appendChild(noteDiv);
                });
            }

            headerCard.addEventListener('click', () => {
                headerCard.classList.toggle('open');
                bodyDiv.classList.toggle('open');
            });

            accordionItem.appendChild(headerCard);
            accordionItem.appendChild(bodyDiv);
            container.appendChild(accordionItem);
        });
    }

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
async function askGemini(userMessage) {
    const apiKey = dataManager.data.geminiApiKey;
    const model = dataManager.data.geminiModelName || 'gemini-3-flash-preview';
    if (!apiKey) return null;

    const totalGrowth = dataManager.getTotalGrowth().toFixed(1);
    const stage = dataManager.getStage();
    const name = dataManager.data.name || "Kullanıcı";
    
    // Ensure model string doesn't have "models/" prefix twice or illegal characters
    const cleanModel = model.replace('models/', '').trim();
    
    // Son 7 günlük kullanıcı notlarını topla (Koç daha iyi yanıt verebilsin diye)
    let recentNotes = [];
    const today = new Date();
    for(let i=0; i<7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dStr = d.toISOString().split('T')[0];
        if(dataManager.data.notes[dStr]) {
            recentNotes.push(`[${dStr}]: ${dataManager.data.notes[dStr].join(' | ')}`);
        }
    }
    const notesContext = recentNotes.length > 0 ? `\nKullanıcının Son Notları:\n${recentNotes.join('\n')}` : "";

    // System Prompt and Context (CHAT MODE: DIRECT & CONCISE)
    const systemContext = `Sen UTakip uygulamasının uzman gelişim koçusun (SOHBET MODU). 
    Kullanıcının adı: ${name}, Yaşı: ${dataManager.data.age}, Başlangıç Boyu: ${dataManager.data.startSize} cm, Güncel Boyu: ${dataManager.data.currentSize} cm.
    Toplam gelişim: ${totalGrowth} mm (${stage}. aşama).${notesContext}
    KRİTİK KURAL: Her yanıta kullanıcının istatistiklerini (yaş, mm gelişim vb.) veya genel tebrik mesajlarını sıralayarak BAŞLAMA. 
    Doğrudan kullanıcının sorusuna cevap ver. İstatistikleri sadece soruyla doğrudan ilgiliyse (örneğin "ne kadar geliştim?" veya "yaşıma göre durumum ne?" diye sorulursa) kullan. 
    Tıbbi doktor olmadığını ama süreç uzmanı olduğunu unutma. Yanıtların kısa, öz, profesyonel ve doğrudan olmalı.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `CONTEXT: ${systemContext}\n\nUSER QUESTION: ${userMessage}` }]
                }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error("Gemini API Error Detail:", data.error);
            if (data.error.status === "NOT_FOUND") {
                return `❌ Model Bulunamadı: '${cleanModel}' bu API versiyonunda (v1beta) mevcut değil. Lütfen 'Modelleri Listele' butonuyla anahtarınızın desteklediği modelleri kontrol edin.`;
            }
            return `❌ Gemini Hatası: ${data.error.message || 'Bilinmeyen Hata'}`;
        }

        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        }
        return "⚠️ Yanıt alınamadı. API anahtarınızın 'Gemini 1.5 Flash' modeline erişimi olduğundan emin olun.";
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
    
    // Check if we use Gemini or Local Search
    if (dataManager.data.geminiApiKey) {
        answer = await askGemini(text);
    } else {
        // Fallback to local search
        const lowerText = text.toLowerCase();
        answer = "Maalesef bu konuda spesifik bir bilgim yok. Ama kütüphaneye göz atabilir veya 'kremler', 'kullanım', 'güvenlik' gibi genel konuları sorabilirsin.";
        let bestMatch = null;
        let maxHits = 0;
        coachKnowledgeBase.forEach(item => {
            let hits = 0;
            item.keys.forEach(k => { if (lowerText.includes(k)) hits++; });
            if (hits > maxHits) { maxHits = hits; bestMatch = item; }
        });
        if (bestMatch) answer = bestMatch.a;
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
        
        let monthTotalMins = 0;
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

        // 1. ACİL DURUM UYARILARI (AŞIRI ÇALIŞMA VEYA TEMBELLİK)
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
        }

        let header = `Merhaba <strong>${name}</strong>,<br>`;
        
        if (workedToday) {
            return header + `Bugünkü hedefini başarıyla tamamlamışsın, harika gidiyorsun! Dinlenirken bugünün rehber tüyosuna (Uzmandan) mutlaka bir göz at:<br><br><span style="padding: 10px; display:inline-block; border:1px dashed #404040; background:rgba(0,0,0,0.1); border-radius: 8px;">${selectedTip}</span>` + journalContext;
        } else {
            return header + `Bugünkü extender sürecini henüz takvime dahil etmemiş görünüyorsun. Antrenmana başlamadan önce, sana tecrübelere dayanan harika bir anatomik tüyom var:\n\n<br><br><span style="padding: 10px; display:inline-block; border:1px dashed #404040; background:rgba(0,0,0,0.1); border-radius: 8px;">${selectedTip}</span>` + journalContext;
        }
    }


    function updateSettingsView() {
        document.getElementById('userName').value = dataManager.data.name || '';
        document.getElementById('userAge').value = dataManager.data.age || '';
        document.getElementById('startDate').value = dataManager.data.startDate || '';
        document.getElementById('startSize').value = (dataManager.data.startSize !== undefined && !isNaN(dataManager.data.startSize)) ? dataManager.data.startSize : '';
        document.getElementById('targetSize').value = (dataManager.data.targetSize !== undefined && !isNaN(dataManager.data.targetSize)) ? dataManager.data.targetSize : '';
        document.getElementById('targetMonthlyGrowth').value = dataManager.data.targetMonthlyGrowth || 2;
        document.getElementById('dailyGoalHours').value = dataManager.data.dailyGoalHours || 6;
        document.getElementById('geminiApiKey').value = dataManager.data.geminiApiKey || '';
        document.getElementById('geminiModelName').value = dataManager.data.geminiModelName || 'gemini-1.5-flash';
        
        if(dataManager.data.currentSize !== undefined && !isNaN(dataManager.data.currentSize)) {
            document.getElementById('currentSize').value = dataManager.data.currentSize;
        } else {
            document.getElementById('currentSize').value = '';
        }
        
        const today = new Date();
        const currentYYYYMM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        if(dataManager.data.monthlyTension && dataManager.data.monthlyTension[currentYYYYMM]) {
            document.getElementById('currentTension').value = dataManager.data.monthlyTension[currentYYYYMM];
        } else {
            document.getElementById('currentTension').value = '';
        }

        // Timer Settings
        document.getElementById('timerCount').value = dataManager.data.timerSettings.count;
        document.getElementById('timerDuration').value = dataManager.data.timerSettings.duration;
        document.getElementById('timerBreak').value = dataManager.data.timerSettings.break;
        document.getElementById('notifSound').checked = dataManager.data.timerSettings.sound;
        document.getElementById('notifVibrate').checked = dataManager.data.timerSettings.vibrate;
    }

    // --- EVENTS ---

    document.getElementById('btnSaveBaseSettings').addEventListener('click', () => {
        const name = document.getElementById('userName').value;
        const age = document.getElementById('userAge').value;
        const date = document.getElementById('startDate').value;
        const size = document.getElementById('startSize').value;
        const target = document.getElementById('targetSize').value;
        const growth = document.getElementById('targetMonthlyGrowth').value;
        const apiKey = document.getElementById('geminiApiKey').value;
        const modelName = document.getElementById('geminiModelName').value;
        const dailyGoal = document.getElementById('dailyGoalHours').value;
        if(!date || !size) return alert("Başlangıç tarihi ve boyutunu girin.");
        
        dataManager.setBaseSettings(name, age, date, size, target, growth, apiKey, modelName, dailyGoal);
        
        // Timer Settings
        const tCount = document.getElementById('timerCount').value;
        const tDur = document.getElementById('timerDuration').value;
        const tBreak = document.getElementById('timerBreak').value;
        const tSound = document.getElementById('notifSound').checked;
        const tVib = document.getElementById('notifVibrate').checked;
        dataManager.setTimerSettings(tCount, tDur, tBreak, tSound, tVib);

        alert("Tüm ayarlar başarıyla kaydedildi.");
        updateSettingsView();
        updateHomeView();
    });

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

    // PWA Güncelleme (v1.7.8 - Ultra Aggressive)
    document.getElementById('btnUpdateApp')?.addEventListener('click', async () => {
        const btn = document.getElementById('btnUpdateApp');
        const originalText = btn.textContent;
        btn.textContent = "🔄 Kontrol Ediliyor...";
        btn.disabled = true;

        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    btn.textContent = "🚀 Güncelleniyor (v1.7.8)...";
                    await registration.update();
                    
                    if (registration.waiting) {
                        sessionStorage.setItem('app_just_updated', 'true');
                        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                        window.location.reload();
                        return;
                    }

                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        sessionStorage.setItem('app_just_updated', 'true');
                        window.location.reload();
                    });

                    setTimeout(() => {
                        if (btn.disabled) {
                            btn.textContent = "📢 Yenileme Gerekli";
                            alert("Sistem güncellendi. Değişikliklerin görünmesi için lütfen uygulamayı kapatıp açın.");
                            btn.disabled = false;
                        }
                    }, 4000);
                }
            } catch (err) {
                console.error(err);
                btn.textContent = "❌ Hata";
                btn.disabled = false;
            }
        } else {
            alert("Sistem PWA desteklemiyor. Lütfen sayfayı manuel yenileyin.");
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });

    // Model Diagnostic Tool
    document.getElementById('btnCheckModels')?.addEventListener('click', async () => {
        const apiKey = document.getElementById('geminiApiKey').value.trim();
        const output = document.getElementById('modelListOutput');
        
        if (!apiKey) return alert("Önce API anahtarını girin.");
        
        output.style.display = 'block';
        output.textContent = "Bağlantı test ediliyor...";
        
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await response.json();
            
            if (data.error) {
                output.innerHTML = `<span style="color: #ff6b6b">❌ Hata: ${data.error.message}</span>`;
            } else if (data.models) {
                const names = data.models
                    .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''));
                
                output.innerHTML = `<strong>Erişilebilir Modeller:</strong><br>` + names.join('<br>');
                alert("Başarılı! Kullanabileceğiniz modeller aşağıda listelendi.");
            }
        } catch (e) {
            output.textContent = "Hata: " + e.message;
        }
    });

    document.getElementById('btnUpdateApp').addEventListener('click', async () => {
        const btn = document.getElementById('btnUpdateApp');
        const originalText = btn.textContent;
        btn.textContent = "🔄 Kontrol Ediliyor...";
        btn.disabled = true;

        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    // Listen for the controller changing (new SW takes over)
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        sessionStorage.setItem('app_just_updated', 'true');
                        window.location.reload();
                    });

                    btn.textContent = "🚀 Güncelleniyor (v1.7.8)...";
                    await registration.update();
                    
                    // If after 3 seconds still no reload, force it
                    setTimeout(() => {
                        sessionStorage.setItem('app_just_updated', 'true');
                        window.location.reload(true);
                    }, 3000);
                } else {
                    window.location.reload(true);
                }
            } catch (e) {
                console.error("SW Update Error:", e);
                alert("Hata: " + e.message);
                btn.textContent = originalText;
                btn.disabled = false;
            }
        } else {
            window.location.reload(true);
        }
    });

    document.getElementById('btnSaveCurrentData').addEventListener('click', () => {
        const cs = document.getElementById('currentSize').value;
        const ct = document.getElementById('currentTension').value;
        if(!cs && !ct) return alert("Lütfen en az bir veriyi doldurun.");
        
        dataManager.setCurrentData(cs, ct);
        alert("Aylık güncel verileriniz yapay zeka hafızasına kaydedildi.");
        updateHomeView();
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
            if (state.current >= dataManager.data.timerSettings.count) {
                dataManager.resetActiveSession();
            }
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

    // --- TIMER LOGIC ---
    let timerInterval = null;

    function updateTimerDisplay() {
        const display = document.getElementById('timerDisplay');
        const btnSession = document.getElementById('btnStartSession');
        const btnBreak = document.getElementById('btnStartBreak');
        const btnManual = document.getElementById('btnAddTime');
        const btnFinalize = document.getElementById('btnFinalizeSession');
        const info = document.getElementById('timerSessionInfo');
        const badge = document.getElementById('timerModeBadge');
        const card = document.getElementById('timerCard');
        const manualSection = document.getElementById('manualTimeSection');
        const metaSection = document.getElementById('sessionMetaSection');
        const saveManualBtn = document.getElementById('btnSaveManual');

        if (!display || !btnSession || !btnBreak || !info || !card || !manualSection || !metaSection) return;

        const state = dataManager.data.activeSessionState;
        const isManualMode = card.classList.contains('mode-manual');
        const toggleBtn = document.getElementById('btnToggleManual');
        
        if (state.mode === 'ready') {
            display.textContent = '00:00:00';
            display.style.opacity = '1';
            
            btnSession.textContent = '▶ Seans Başlat';
            btnSession.className = 'btn-primary';
            btnBreak.textContent = '☕ Mola Başlat';
            btnBreak.className = 'btn-secondary';
            
            btnFinalize.style.display = 'none';
            metaSection.style.display = 'block';
            
            info.textContent = `Hedef: ${dataManager.data.timerSettings.count} Seans`;
            card.classList.add('mode-ready');
            card.classList.remove('mode-work', 'mode-break', 'mode-review');
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
            display.style.opacity = '0.4'; // Silik görünüm
            
            btnSession.style.display = 'none';
            btnBreak.style.display = 'none';
            btnManual.style.display = 'none';
            btnFinalize.style.display = 'block';
            manualSection.style.display = 'none';
            metaSection.style.display = 'block';
            badge.textContent = 'Kayıt Bekliyor';
            badge.className = 'timer-badge mode-review';
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
        
        if (state.mode === 'work') {
            metaSection.style.display = 'none'; // Çalışırken gizle
            info.textContent = `Seans ${state.current} / ${dataManager.data.timerSettings.count}`;
            badge.textContent = 'Çalışma Modu';
            badge.className = 'timer-badge mode-work';
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

    /* --- EDIT MODAL LOGIC (v1.7.9) --- */
    let currentEditDate = null;
    const editModal = document.getElementById('editModalOverlay');
    const editHoursInput = document.getElementById('editHours');
    const editMinutesInput = document.getElementById('editMinutes');
    const editTotalLabel = document.getElementById('editTotalMinsLabel');

    function openEditModal(dateStr) {
        currentEditDate = dateStr;
        const sessions = dataManager.data.sessions[dateStr] || [];
        // Eğer zaten o günün bir seansı varsa ilkini baz alalım (düzenleme için)
        // Yoksa 0'dan başla
        const firstSessionMins = sessions.length > 0 ? sessions[0].mins : 0;
        
        editHoursInput.value = Math.floor(firstSessionMins / 60);
        editMinutesInput.value = firstSessionMins % 60;
        updateEditModalTotal();
        
        const dateObj = new Date(dateStr);
        document.getElementById('editModalTargetDate').textContent = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
        
        editModal.classList.add('show');
    }

    function closeEditModal() {
        editModal.classList.remove('show');
        currentEditDate = null;
    }

    function updateEditModalTotal() {
        const h = parseInt(editHoursInput.value) || 0;
        const m = parseInt(editMinutesInput.value) || 0;
        editTotalLabel.textContent = (h * 60) + m;
    }

    document.querySelectorAll('.edit-stepper-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseInt(btn.getAttribute('data-delta'));
            const activeBox = document.querySelector('.edit-modal .dual-box.active');
            if(!activeBox) return;
            
            const inputId = activeBox.getAttribute('data-target');
            const input = document.getElementById(inputId);
            let val = parseInt(input.value) || 0;
            val += delta;
            if (val < 0) val = 0;
            if (inputId === 'editMinutes' && val > 59) val = 59;
            
            input.value = val;
            updateEditModalTotal();
        });
    });

    // Modal içindeki kutucuk seçimi
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
        
        const h = parseInt(editHoursInput.value) || 0;
        const m = parseInt(editMinutesInput.value) || 0;
        const totalMins = (h * 60) + m;

        // Eski kayıtları temizleyip yeni toplamı ekleyelim (Kullanıcı o günü "Düzenle"miş oluyor)
        if (totalMins === 0) {
            delete dataManager.data.sessions[currentEditDate];
        } else {
            // Basitlik adına o günün tüm seanslarını tek bir seansa indirgeyelim (Düzenleme mantığı)
            dataManager.data.sessions[currentEditDate] = [{
                mins: totalMins,
                diff: 'normal',
                note: 'Geçmiş kayıt / Düzenleme'
            }];
        }
        
        dataManager.save();
        closeEditModal();
        updateCalendarView();
        updateHomeView();
        showSuccessAchievement("Başarılı!", "Takvim verisi güncellendi.", "📅");
    });

    function manualSaveAndEndSession() {
        const state = dataManager.data.activeSessionState;
        const elapsedMs = Date.now() - state.startTime;
        
        // Timer'ı durdur ve review moduna geç
        if (timerInterval) clearInterval(timerInterval);
        state.frozenElapsed = elapsedMs;
        state.mode = 'review';
        dataManager.save();
        updateTimerDisplay();
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

    // --- UNIVERSAL STEPPER LOGIC ---
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
            if (container.classList.contains('single')) return; // Mola gibi tekli alanlarda seçime gerek yok zaten aktif

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
            if (val < 1 && inputId !== 'timerBreak' && inputId !== 'inputHours' && inputId !== 'inputMinutes') val = 1;
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
            // Ayarlar sekmesine tıkla (navBtns[3])
            if (navBtns[3]) navBtns[3].click();

            const verText = document.getElementById('appVersionText');
            if (verText) {
                const originalText = verText.textContent;
                verText.style.color = '#2ecc71'; // Yeşil renk
                verText.style.fontWeight = '700';
                verText.textContent = '✅ Uygulamanız v1.7.8 sürümüne güncellendi!';
                
                setTimeout(() => {
                    verText.style.color = '';
                    verText.style.fontWeight = '';
                    verText.textContent = originalText;
                }, 5000);
            }
        }
    }

    // Init App
    // Restore entry mode
    if (localStorage.getItem('timer_entry_mode') === 'manual') {
        const card = document.getElementById('timerCard');
        if (card) {
            card.classList.add('is-manual-view');
            const icon = document.querySelector('#btnToggleManual span');
            if (icon) icon.textContent = 'timer';
        }
    }

    renderRulerScale();
    updateSettingsView();
    updateHomeView();
    checkUpdateStatus();
    if (dataManager.data.timerStartTime > 0) startTimerUI();
});
