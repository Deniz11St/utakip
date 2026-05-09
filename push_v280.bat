@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
git add -A
git commit -m "v2.8.1: Eski format migrasyon desteği - Firebase tek-blok verisi otomatik granüler formata dönüşüyor"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi her iki cihazda da uygulamayi yenile.
pause
