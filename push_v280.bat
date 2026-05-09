@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
git add -A
git commit -m "v2.8.2: Eşzamanlı düzenleme iyileştirmesi - Push bloklaması kaldırıldı"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi her iki cihazda da uygulamayi yenile (v2.8.2).
pause
