@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
git add -A
git commit -m "v2.8.3: Senkronizasyon yarışı ve bloklama sorunları giderildi - Zorla Eşitle butonu eklendi"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi her iki cihazda da uygulamayi yenile (v2.8.3).
pause
