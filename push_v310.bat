@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v301.bat
git add -A
git commit -m "v3.1.0: Versiyon numarasi guncellendi ve GitHub'a yuklendi"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.1.0) surumunu kullanmaya basla.
pause
