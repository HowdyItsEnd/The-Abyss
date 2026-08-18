@echo off
setlocal enabledelayedexpansion

echo ===================================
echo   Git Automation Script
echo ===================================
echo.

REM Ask for the repo link
set /p REPO_URL="Enter the repo link: "

if "%REPO_URL%"=="" (
    echo No repo URL provided. Exiting.
    exit /b 1
)

REM Check if current directory is already a git repo
if exist ".git" (
    echo A git repository already exists in this folder.
    echo Setting remote 'origin' to the provided URL...
    git remote remove origin >nul 2>&1
    git remote add origin "%REPO_URL%"
) else (
    echo No git repository found here.
    echo Initializing repo and setting remote 'origin'...
    git init
    git remote add origin "%REPO_URL%"
)

REM Set upstream tracking to main
echo.
echo Fetching from remote...
git fetch origin

REM Try to check out main, create it if it doesn't exist locally
git rev-parse --verify main >nul 2>&1
if errorlevel 1 (
    echo Local branch 'main' does not exist. Creating it...
    git checkout -b main
) else (
    git checkout main
)

echo.
echo Staging all changes (git add .)...
git add .

echo.
set /p COMMIT_MSG="Enter your commit message: "

if "%COMMIT_MSG%"=="" (
    echo No commit message provided. Exiting.
    exit /b 1
)

git commit -m "%COMMIT_MSG%"

if errorlevel 1 (
    echo.
    echo Nothing to commit, or commit failed. Skipping push.
    goto :end
)

echo.
echo Pushing to origin main and setting upstream...
git push -u origin main

:end
echo.
echo ===================================
echo   Done!
echo ===================================
pause
