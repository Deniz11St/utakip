@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v311.bat
git add -A
git commit -m "v3.1.2: Syntax error fix and Roadmap UI implementation"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.1.2) surumunu kullanmaya basla.
pause
