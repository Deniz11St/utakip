@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
del push_v300.bat
git add -A
git commit -m "v3.0.1: Yapay zeka surumu guncellendi ve Vida Boyutu birimi cm olarak ayarlandi"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.0.1) surumunu kullanmaya basla.
pause
