@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v312.bat
git add -A
git commit -m "v3.1.3: Roadmap dynamic date, custom formatting, and version update"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.1.3) surumunu kullanmaya basla.
pause
