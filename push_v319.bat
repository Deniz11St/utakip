@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v318.bat
git add -A
git commit -m "v3.1.9: FLIP layout animation timing fix with double requestAnimationFrame, version update"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.1.9) surumunu kullanmaya basla.
pause
