.PHONY: setup start dev tunnel tunnel-quick build-release

RUNTIME ?= web
TARGET ?= all

ifeq ($(OS),Windows_NT)
  SHELL_CMD = powershell -ExecutionPolicy Bypass -File
  EXT = .ps1
  RUNTIME_ARG = -Runtime $(RUNTIME)
  TARGET_ARG = -Target $(TARGET)
else
  SHELL_CMD = bash
  EXT = .sh
  RUNTIME_ARG = --runtime $(RUNTIME)
  TARGET_ARG = --target $(TARGET)
endif

setup:
	$(SHELL_CMD) setup$(EXT)

start:
	$(SHELL_CMD) start$(EXT) $(RUNTIME_ARG)

dev:
	$(SHELL_CMD) start-dev$(EXT) $(RUNTIME_ARG)

tunnel:
	$(SHELL_CMD) tunnel$(EXT)

tunnel-quick:
	$(SHELL_CMD) tunnel-quick$(EXT)

build-release:
	$(SHELL_CMD) build-release$(EXT) $(TARGET_ARG)
