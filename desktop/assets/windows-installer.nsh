# Prefer a writable fixed D: drive for a fresh, per-user install only.
# Existing install locations and an explicit /D= argument always win.
!macro customHeader
!ifndef BUILD_UNINSTALLER
  Function LumiorPreferDDrive
    ${If} $installMode != "CurrentUser"
      Return
    ${EndIf}
    ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R0 != ""
      Return
    ${EndIf}
    ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R0 != ""
      Return
    ${EndIf}
    !insertmacro GetDParameter $R0
    ${If} $R0 != ""
      Return
    ${EndIf}
    System::Call 'kernel32::GetDriveTypeW(w "D:\") i .r0'
    ${If} $0 != 3
      Return
    ${EndIf}
    ClearErrors
    GetTempFileName $R1 "D:\"
    ${IfNot} ${Errors}
      Delete $R1
      StrCpy $INSTDIR "D:\${APP_FILENAME}"
    ${EndIf}
  FunctionEnd
!endif
!macroend

  !macro customInit
    Call LumiorPreferDDrive
  !macroend

  # The install-mode page reinitializes INSTDIR after customInit. Keep this
  # preview per-user and apply the same rule before the directory page opens.
  !macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $installMode == "CurrentUser"
    ${AndIfNot} ${isForAllUsers}
      !insertmacro setInstallModePerUser
      Call LumiorPreferDDrive
      Abort
    ${EndIf}
  !endif
  !macroend
