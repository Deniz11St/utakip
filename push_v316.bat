@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v315.bat
git add -A
git commit -m "v3.1.6: Scroll interference UX fix and version update"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.1.6) surumunu kullanmaya basla.
pause
