@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v310.bat
git add -A
git commit -m "v3.1.1: Yol haritasi ve kalicilik hesabi guncellendi"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.1.1) surumunu kullanmaya basla.
pause
