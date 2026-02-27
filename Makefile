.PHONY: setup start dev tunnel tunnel-quick

ifeq ($(OS),Windows_NT)
  SHELL_CMD = powershell -ExecutionPolicy Bypass -File
  EXT = .ps1
else
  SHELL_CMD = bash
  EXT = .sh
endif

setup:
	$(SHELL_CMD) setup$(EXT)

start:
	$(SHELL_CMD) start$(EXT)

dev:
	$(SHELL_CMD) start-dev$(EXT)

tunnel:
	$(SHELL_CMD) tunnel$(EXT)

tunnel-quick:
	$(SHELL_CMD) tunnel-quick$(EXT)
