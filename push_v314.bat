@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v313.bat
git add -A
git commit -m "v3.1.4: Retroactive timer feature, temporary temporal offset, and version update"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.1.4) surumunu kullanmaya basla.
pause
