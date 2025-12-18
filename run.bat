@echo off
echo Running tests...
call npm test
if %ERRORLEVEL% NEQ 0 (
    echo Tests failed. Aborting start.
    exit /b %ERRORLEVEL%
)
echo Tests passed! Starting ByteBot...
node .\src\index.js
