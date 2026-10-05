# 단축키 복구와 등록 체계

비교 기준은 사용자 보고 커밋 `36d5ddebc37e1a731dadca9912ea39d0992297c8`, 원본 `e02eeba66b4801ebae0b686e1b0e4bc03fbf3654`로 고정했다. 이 문서는 현재 등록 체계에서 생성한 표이며 브라우저 검증 결과는 최종 복구 보고서에 별도 기록한다.

## 확인한 원인과 수정

- 이전 `modernKeybinds()`는 Classic 저장값을 먼저 할당했다. 옛 W 이동·Q/E 확대축소가 현대 군종 기본값을 비활성화할 수 있었다. 이전 회귀 테스트도 그 상태를 기대했다. 이제 Classic 프로필은 보존하고 현대 프로필을 한 번 마이그레이션한다.
- 명령과 미리보기가 같은 `ModernTargetEvent` 경로를 사용했다. 이제 hover는 `ModernPreviewEvent`, 우클릭/확정 터치는 `ModernTargetEvent`이다. CSS 화면 좌표를 그대로 전달하고 지도 변환은 패널의 기존 TransformHandler가 담당한다. 오래된 hover 요청은 RAF마다 최신 하나로 합치고 명령 확정·선택 시작·blur·destroy 때 취소한다. 시뮬레이션 판단에는 RAF를 사용하지 않는다.
- 현대 군종 키는 keydown에서 즉시 선택하고 repeat/keyup 중복을 막는다. 텍스트·한국어 조합·키 편집·모달이 지도보다 우선한다. 리플레이는 카메라·도움말·허용된 재생 조작만 받는다. 원본 Classic의 숫자 건설 키와 Numpad 별칭, 플랫폼별 Ctrl 클릭, 시설 가운데 클릭 업그레이드는 유지한다.
- 버튼·설정·도움말·교육은 `KeybindingRegistry`와 `UserSettings.effectiveKeybinds()`의 현재 값으로 표시한다. 기존 숫자 키 툴팁도 현대 프로필을 사용하며 변경 이벤트를 즉시 반영한다.

## 저장값과 마이그레이션

`settings.input.v2`는 현대 유효 바인딩을 버전 2로 저장한다. 최초 쓰기 전에 `settings.input.backup.v1`에 `settings.keybinds`와 옛 `settings.modernKeybinds.v1` 원문을 백업한다. Classic 원문은 수정하지 않는다.

옛 기본값과 같은 항목은 새 현대 기본값을 적용한다(Q/W/E 군종, 방향키 이동, B 건설, F 화면 내 부대). 명시적 사용자 변경으로 추정되는 값은 충돌하지 않으면 보존한다. 옛 군종별 지정 키도 충돌하지 않으면 표에 보이는 추가 키 action으로 보존하여 Q/W/E를 유지한다. 필수 현대 기본 조작과 충돌하는 항목은 미지정으로 기록하고 설정의 이전 설정 변경 목록에 이전 값·대체 값·이유를 보여준다. 옛 형식은 변경 의도를 기록하지 않아 기본값과 같은 명시적 재지정은 구분할 수 없다.

새 편집에서는 정규화된 키 조합의 충돌을 거절한다. Alt의 보조 동작/이모지와 Shift의 보조 동작/Classic 군함 상자 선택만 의도된 공유를 허용한다. 현대 프로필 초기화는 Classic과 백업을 보존한다. 저장소 쓰기에 실패하면 Q/W/E 기본값은 계속 사용할 수 있고 편집 저장은 실패로 반환한다. 프로필 이동과 초기화는 시뮬레이션 상태를 바꾸지 않는다.

지도에서는 왼쪽 드래그가 선택, Alt+드래그가 카메라 이동이다. 현대 모바일은 한 손가락 선택, 두 손가락 이동·핀치 확대, 목표 지정→터치/드래그 미리보기→명령 확정의 흐름을 사용한다. 핵 숫자 키는 목표 배치 준비만 하며 실제 발사는 기존 확인 흐름을 거친다.

## 전체 기본 조작표

등록 체계는 104개 action을 포함한다. 추가 선택과 후속 명령의 터치 토글도 동일한 표의 화면 동작이다.

기본 표는 Windows/Linux 기준이다. macOS의 건설 수식키는 Meta이며 도움말은 현재 플랫폼과 실제 저장 바인딩으로 갱신된다. 사용자 재지정·미지정이 있으면 실제 화면의 표가 우선이다. 화면 버튼 action의 미지정은 그 기능 삭제를 뜻하지 않는다. `release`는 키를 놓을 때 한 번, `press`는 처음 누를 때 한 번, `hold`는 지도 카메라 연속 조작, `modifier`는 다른 조작의 보조 키이다. 일시정지·배속·저장·이어하기는 게임 유형의 기존 허용 조건을 따른다. 시설 자동 업그레이드 항목은 제공되는 UI/설정의 범위를 설명하며 존재하지 않는 Shift+가운데 클릭 명령을 만들지 않는다.

| action ID                  | 기능                      | Classic 기본값     | 현대 기본값        | 단계 · 허용 컨텍스트       | 설명                                                                                                      |
| -------------------------- | ------------------------- | ------------------ | ------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `toggleView`               | 보기 전환                 | Space              | Space              | press · map, replay        | 지도 보기 전환 (지형/국가)                                                                                |
| `coordinateGrid`           | 좌표 격자                 | KeyM               | KeyM               | press · map, replay        | 좌표 격자 오버레이 전환                                                                                   |
| `buildCity`                | 도시 건설                 | Digit1             | Digit1             | release · map              | 커서 위치에 도시를 건설합니다.                                                                            |
| `buildFactory`             | 공장 건설                 | Digit2             | Digit2             | release · map              | 커서 위치에 공장을 건설합니다.                                                                            |
| `buildPort`                | 항구 건설                 | Digit3             | Digit3             | release · map              | 커서 위치에 항구를 건설합니다.                                                                            |
| `buildDefensePost`         | 방어 초소 건설            | Digit4             | Digit4             | release · map              | 커서 위치에 방어 초소를 건설합니다.                                                                       |
| `buildMissileSilo`         | 미사일 발사대 건설        | Digit5             | Digit5             | release · map              | 커서 위치에 미사일 발사대를 건설합니다.                                                                   |
| `buildSamLauncher`         | 지대공미사일 발사대 건설  | Digit6             | Digit6             | release · map              | 커서 위치에 지대공미사일 발사대를 건설합니다.                                                             |
| `buildWarship`             | 군함 건조                 | Digit7             | Digit7             | release · map              | 커서 위치에 군함을 건조합니다.                                                                            |
| `buildAtomBomb`            | 원자폭탄 준비             | Digit8             | Digit8             | release · map              | 무기와 목표를 준비합니다. 키 한 번만으로 핵을 발사하지 않습니다.                                          |
| `buildHydrogenBomb`        | 수소폭탄 준비             | Digit9             | Digit9             | release · map              | 비용·목표·발사 책임 페널티를 확인하고 확정합니다.                                                         |
| `buildMIRV`                | MIRV 준비                 | Digit0             | Digit0             | release · map              | MIRV 목표를 준비합니다. 한 번 발사의 책임은 한 번 적용됩니다.                                             |
| `attackRatioDown`          | 공격 비율 낮추기          | KeyT               | KeyT               | release · map              | 공격 비율을 {amount}% 감소                                                                                |
| `attackRatioUp`            | 공격 비율 높이기          | KeyY               | KeyY               | release · map              | 공격 비율을 {amount}% 증가                                                                                |
| `boatAttack`               | 상륙 공격                 | KeyB               | Shift+KeyB         | release · map              | 커서 아래 타일에 상륙 공격을 보내보세요.                                                                  |
| `groundAttack`             | 지상전                    | KeyG               | KeyG               | release · map              | 커서 아래 타일에 지상 공격을 보냅니다.                                                                    |
| `retaliateAttack`          | 반격                      | Shift+KeyR         | Shift+KeyR         | release · map              | 가장 최근에 공격한 적의 병력을 둔화/상쇄하기 위해 반격을 보냅니다. 공격받고 있을 때만 사용할 수 있습니다. |
| `requestAlliance`          | 동맹 요청                 | KeyK               | KeyK               | release · map              | 커서 위치 타일의 플레이어에게 동맹 요청을 보냅니다.                                                       |
| `breakAlliance`            | 동맹 파기 (배신)          | KeyL               | KeyL               | release · map              | 커서 위치 타일의 플레이어와 동맹을 파기합니다.                                                            |
| `swapDirection`            | 로켓 방향 전환            | KeyU               | KeyU               | release · map              | 로켓 발사 방향 전환 (상/하).                                                                              |
| `zoomOut`                  | 축소                      | KeyQ               | 미지정 / 화면 버튼 | hold · map, replay         | 지도로 축소                                                                                               |
| `zoomIn`                   | 확대                      | KeyE               | 미지정 / 화면 버튼 | hold · map, replay         | 지도로 확대                                                                                               |
| `centerCamera`             | 카메라 중앙 이동          | KeyC               | KeyC               | press · map, replay        | 현대 모드에서 선택 부대, 선택이 없으면 내 국가로 이동합니다.                                              |
| `moveUp`                   | 위로 카메라 이동          | KeyW               | 미지정 / 화면 버튼 | hold · map, replay         | 카메라를 위로 이동                                                                                        |
| `moveLeft`                 | 왼쪽으로 카메라 이동      | KeyA               | 미지정 / 화면 버튼 | hold · map, replay         | 카메라를 왼쪽으로 이동                                                                                    |
| `moveDown`                 | 아래로 카메라 이동        | KeyS               | 미지정 / 화면 버튼 | hold · map, replay         | 카메라를 아래로 이동                                                                                      |
| `moveRight`                | 오른쪽으로 카메라 이동    | KeyD               | 미지정 / 화면 버튼 | hold · map, replay         | 카메라를 오른쪽으로 이동                                                                                  |
| `moveUpArrow`              | 위로 카메라 이동          | ArrowUp            | ArrowUp            | hold · map, replay         | 카메라를 위로 이동                                                                                        |
| `moveDownArrow`            | 아래로 카메라 이동        | ArrowDown          | ArrowDown          | hold · map, replay         | 카메라를 아래로 이동                                                                                      |
| `moveLeftArrow`            | 왼쪽으로 카메라 이동      | ArrowLeft          | ArrowLeft          | hold · map, replay         | 카메라를 왼쪽으로 이동                                                                                    |
| `moveRightArrow`           | 오른쪽으로 카메라 이동    | ArrowRight         | ArrowRight         | hold · map, replay         | 카메라를 오른쪽으로 이동                                                                                  |
| `zoomOutMinus`             | 축소                      | Minus              | Minus              | hold · map, replay         | 지도로 축소                                                                                               |
| `zoomOutNumpad`            | 축소                      | NumpadSubtract     | NumpadSubtract     | hold · map, replay         | 지도로 축소                                                                                               |
| `zoomInEqual`              | 확대                      | Equal              | Equal              | hold · map, replay         | 지도로 확대                                                                                               |
| `zoomInNumpad`             | 확대                      | NumpadAdd          | NumpadAdd          | hold · map, replay         | 지도로 확대                                                                                               |
| `performanceOverlay`       | 성능 표시                 | Shift+KeyD         | Shift+KeyD         | release · map              | 기존 개발용 성능 표시를 켭니다.                                                                           |
| `buildMenuModifier`        | 건설 메뉴 수정기          | ControlLeft        | ControlLeft        | modifier · map             | 빌드 메뉴를 열려면 이 키를 누른 상태로 클릭하십시오.                                                      |
| `emojiMenuModifier`        | 이모티콘 메뉴 수정자      | AltLeft            | AltLeft            | modifier · map             | 이 키를 누른 상태에서 클릭하면 이모지 메뉴가 열립니다.                                                    |
| `boxSelectWarships`        | 군함 드래그 선택          | ShiftLeft          | ShiftLeft          | modifier · map             | 이 키를 누른 상태로 드래그하여 여러 군함을 선택하세요.                                                    |
| `shiftKey`                 | 선택·명령 수식키          | ShiftLeft          | ShiftLeft          | modifier · map             | 추가 선택·후속 명령 등 명시된 마우스 동작에 사용합니다.                                                   |
| `resetGfx`                 | 그래픽 초기화             | Alt+KeyR           | Alt+KeyR           | release · map, replay      | 설정된 그래픽 수식키와 이 키를 함께 눌러 렌더링을 초기화합니다. 이 키만으로 초기화하지 않습니다.          |
| `selectAllWarships`        | 모든 군함 선택            | KeyF               | Shift+KeyF         | release · map              | 지도에 있는 모든 군함을 선택합니다.                                                                       |
| `pauseGame`                | 일시정지·재개             | KeyP               | KeyP               | release · map, replay      | 허용된 싱글플레이·리플레이에서 사용합니다. 정지 중 병력은 증가하지 않습니다.                              |
| `gameSpeedUp`              | 게임 속도 증가            | Period             | Period             | release · map, replay      | 허용된 로컬 모드에서 게임 진행 속도를 올립니다.                                                           |
| `gameSpeedDown`            | 게임 속도 감소            | Comma              | Comma              | release · map, replay      | 허용된 로컬 모드에서 게임 진행 속도를 내립니다.                                                           |
| `altKey`                   | 보조 동작 수식키          | AltLeft            | AltLeft            | modifier · map             | 설명된 보조 조작에 사용합니다. 이 키만으로 명령하지 않습니다.                                             |
| `modernArmy`               | 육군 선택                 | 해당 모드 아님     | KeyQ               | press · map                | 육군 모드를 선택합니다. 선택만으로 출정하지 않습니다.                                                     |
| `modernNavy`               | 해군 선택                 | 해당 모드 아님     | KeyW               | press · map                | 함선을 선택합니다. 육지는 해군 목적지가 아닙니다.                                                         |
| `modernAir`                | 공군 선택                 | 해당 모드 아님     | KeyE               | press · map                | 전투기·공격기를 선택합니다. 공군은 영토를 점령하지 않습니다.                                              |
| `modernArmyAlternate`      | 육군 선택                 | 해당 모드 아님     | 미지정 / 화면 버튼 | press · map                | 육군 모드를 선택합니다. 선택만으로 출정하지 않습니다.                                                     |
| `modernNavyAlternate`      | 해군 선택                 | 해당 모드 아님     | 미지정 / 화면 버튼 | press · map                | 함선을 선택합니다. 육지는 해군 목적지가 아닙니다.                                                         |
| `modernAirAlternate`       | 공군 선택                 | 해당 모드 아님     | 미지정 / 화면 버튼 | press · map                | 전투기·공격기를 선택합니다. 공군은 영토를 점령하지 않습니다.                                              |
| `modernStop`               | 선택 부대 정지            | 해당 모드 아님     | KeyX               | press · map                | 선택 부대의 진행 중 명령을 정지합니다.                                                                    |
| `modernSelectVisible`      | 화면 내 군종 부대 선택    | 해당 모드 아님     | KeyF               | press · map                | 현재 화면에 보이는 내 군종 부대를 선택합니다.                                                             |
| `buildMenu`                | 건설 메뉴 열기            | 미지정 / 화면 버튼 | KeyB               | press · map                | 건설 항목을 엽니다. 유효한 위치를 지정해야 합니다.                                                        |
| `help`                     | 전체 조작표·도움말        | KeyH               | KeyH               | press · map, replay        | 실제 유효한 전체 조작표와 실습 챕터를 엽니다.                                                             |
| `cancel`                   | 현재 조작 취소            | Escape             | Escape             | press · map, replay, modal | 맨 위 창, 배치·미리보기, 선택 순서로 취소합니다. 진행 중 명령은 정지로 멈춥니다.                          |
| `confirmPlacement`         | 배치 확정                 | Enter              | Enter              | press · map                | 준비한 유효 위치의 건설을 확정합니다. 위험한 무기는 발사 전 확인합니다.                                   |
| `replayStepBack`           | 리플레이 이전 프레임      | BracketLeft        | BracketLeft        | press · replay             | 기록된 한 프레임 뒤로 이동합니다. 리플레이는 군사 명령을 받지 않습니다.                                   |
| `replayStepForward`        | 리플레이 다음 프레임      | BracketRight       | BracketRight       | press · replay             | 기록된 한 프레임 앞으로 이동합니다.                                                                       |
| `replayJumpBack`           | 리플레이 100프레임 뒤로   | Shift+BracketLeft  | Shift+BracketLeft  | press · replay             | 기록된 100프레임 뒤로 이동합니다.                                                                         |
| `replayJumpForward`        | 리플레이 100프레임 앞으로 | Shift+BracketRight | Shift+BracketRight | press · replay             | 기록된 100프레임 앞으로 이동합니다.                                                                       |
| `pointerSelect`            | 부대 선택·기존 지도 클릭  | MouseLeft          | MouseLeft          | pointer · map              | 현대: 내 부대를 좌클릭합니다. Classic: 기존 지도 동작입니다.                                              |
| `pointerBoxSelect`         | 상자 선택                 | Shift+MouseDrag    | MouseDrag          | pointer · map              | 현대는 좌드래그로 현재 군종을 선택합니다. Classic은 군함 선택 수식키를 사용합니다.                        |
| `pointerCommand`           | 목적지 명령·상황 메뉴     | MouseRight         | MouseRight         | pointer · map              | 현대: 유효한 커서 미리보기에서 우클릭하면 즉시 이동·공격합니다. Classic: 상황 메뉴입니다.                 |
| `pointerQueue`             | 경유·후속 명령            | Shift+MouseRight   | Shift+MouseRight   | pointer · map              | Shift+우클릭으로 현재 명령 뒤 유효한 목적지를 예약합니다.                                                 |
| `pointerAdditional`        | 추가 선택                 | Shift+MouseLeft    | Shift+MouseLeft    | pointer · map              | Shift+좌클릭으로 기존 선택에 부대를 추가합니다.                                                           |
| `pointerPan`               | 카메라 드래그             | MouseDrag          | Alt+MouseDrag      | pointer · map, replay      | 현대: Alt+드래그. Classic: 일반 드래그. 터치: 두 손가락 이동.                                             |
| `pointerZoom`              | 지도 확대·축소            | Wheel              | Wheel              | pointer · map, replay      | 휠을 굴립니다. 터치는 두 손가락으로 벌리거나 모읍니다.                                                    |
| `pointerRatio`             | 공격 비율 조절            | Shift+Wheel        | Shift+Wheel        | pointer · map              | Shift+휠로 공격 비율을 조절합니다.                                                                        |
| `pointerUpgrade`           | 주변 시설 업그레이드      | MouseMiddle        | MouseMiddle        | pointer · map              | 가운데 클릭으로 주변의 비용을 감당할 수 있는 시설을 업그레이드합니다.                                     |
| `pointerBuildMenu`         | 건설 메뉴 수식키 클릭     | Ctrl+MouseLeft     | Ctrl+MouseLeft     | pointer · map              | 설정된 건설 메뉴 수식키를 누르고 지도를 좌클릭합니다. Mac의 기본값은 Command입니다.                       |
| `pointerEmojiMenu`         | 소통 메뉴 수식키 클릭     | Alt+MouseLeft      | Alt+MouseLeft      | pointer · map              | 설정된 이모지 메뉴 수식키를 누르고 국가를 좌클릭합니다.                                                   |
| `touchSelect`              | 터치 선택                 | Tap                | Tap                | pointer · map              | 내 부대를 터치하거나 화면 선택 버튼을 사용합니다.                                                         |
| `touchPan`                 | 터치 카메라 이동          | TouchDrag          | TwoFingerDrag      | pointer · map, replay      | 현대: 두 손가락으로 이동합니다. Classic: 기존 드래그를 사용합니다.                                        |
| `touchZoom`                | 터치 확대·축소            | Pinch              | Pinch              | pointer · map, replay      | 두 손가락을 모으거나 벌려 지도를 확대·축소합니다.                                                         |
| `touchCommand`             | 터치 목적지 명령          | LongPress          | TargetTap          | pointer · map              | 현대: 목표 버튼 → 지도 터치 → 유효 미리보기 확인 순서입니다. Classic: 길게 눌러 상황 메뉴를 엽니다.       |
| `saveGame`                 | 게임 저장                 | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 저장 패널에서 실제 게임 상태를 tick 경계에 저장합니다.                                                    |
| `loadGame`                 | 불러오기·이어하기         | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 저장 관리에서 호환되는 저장을 선택합니다. 버전 오류 때 원본 저장을 보존합니다.                            |
| `replayGame`               | 리플레이 복습             | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 결과 화면에서 리플레이를 엽니다. 복습 중 군사 명령은 실행하지 않습니다.                                   |
| `restartGame`              | 시나리오 재시작           | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 저장 패널이나 결과 화면에서 새 게임으로 다시 시작합니다.                                                  |
| `upgradeFacility`          | 시설 업그레이드           | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 선택 시설 패널에서 실행합니다. 금과 현재 소유권을 검사합니다.                                             |
| `autoUpgrade`              | 자동 업그레이드           | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 사용 가능한 기존 시설 설정을 사용합니다. 제공되지 않는 Shift+가운데 클릭을 의미하지 않습니다.             |
| `embargo`                  | 금수조치                  | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 국가 외교에서 선택 세력과의 교역을 제한합니다.                                                            |
| `donateTroops`             | 병력 지원                 | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 국가 외교에서 허용된 병력을 이전합니다. 현대 인력 회계는 인력을 한 번만 이전합니다.                       |
| `donateGold`               | 금 지원                   | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 규칙이 허용할 때 국가 외교에서 금을 보냅니다.                                                             |
| `markTarget`               | 목표 지정                 | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 국가 외교의 목표 지정 동작으로 목표를 공유합니다.                                                         |
| `quickChat`                | 빠른 대화·이모지          | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 국가의 기존 소통 메뉴를 선택합니다. 문자 입력 중 군사 키는 실행하지 않습니다.                             |
| `deleteFacility`           | 시설 삭제                 | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 내 시설을 선택하고 삭제 동작으로 실제 제거를 확인합니다.                                                  |
| `cancelAttack`             | 육상 공격 철수            | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 기존 공격 취소 동작이나 선택한 현대 부대 취소를 사용합니다.                                               |
| `cancelTransport`          | 수송 취소                 | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · map               | 수송선을 선택하고 기존 수송 조작으로 취소합니다.                                                          |
| `replaySeek`               | 리플레이 시점 이동        | 미지정 / 화면 버튼 | 미지정 / 화면 버튼 | button · replay            | 리플레이 시간줄에서 기록된 다른 tick을 확인합니다. 게임 명령을 보내지 않습니다.                           |
| `buildArmyBase`            | 육군 기지 건설            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 기지·생산에서 내 육지를 지정하고 완공 뒤 육군을 훈련합니다.                                               |
| `buildNavalBase`           | 해군 기지 건설            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 항해 가능한 내 해안의 항구를 건설·개발합니다. 군사·교역 역할은 같은 시설입니다.                           |
| `buildAirBase`             | 공군 기지 건설            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 내 육지에 건설합니다. 용량·완공 시간·피해가 출격에 영향을 줍니다.                                         |
| `trainArmy`                | 육군 훈련                 | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 운영 중인 육군 기지에서 비용·인력을 예약하고 집결 위치에 부대가 완성될 때까지 기다립니다.                 |
| `produceWarship`           | 군함 생산                 | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 운영 중인 해군 기지에서 비용·승조원을 예약하고 함선 완공을 기다립니다.                                    |
| `produceFighter`           | 전투기 생산               | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 여유 용량이 있는 운영 중인 공군 기지에서 비용·인력을 예약하고 생산을 기다립니다.                          |
| `produceStrike`            | 공격기 생산               | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 운영 중인 공군 기지에서 공격기를 생산합니다. 용량과 유한 인력 제한이 적용됩니다.                          |
| `developPort`              | 주요 항구 개발            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 내 주요 항구의 다음 개발 비용을 내고 완공 뒤 수입 변화를 확인합니다.                                      |
| `repairPort`               | 주요 항구 복구            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 피해를 입은 내 항구에 비용을 내고 복구를 기다립니다. 점령은 기존 상태를 보존합니다.                       |
| `trainClimate`             | 기후 적응 훈련            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 새 적응에 비용을 내고 실제 훈련 완료를 기다립니다. 점령만으로 적응하지 않습니다.                          |
| `touchAdditionalSelection` | 추가 선택 모드            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 추가 선택 버튼을 켜고 내 부대를 터치하거나 드래그하여 기존 선택에 더합니다.                               |
| `touchQueuedCommand`       | 후속 명령 모드            | 해당 모드 아님     | 미지정 / 화면 버튼 | button · map               | 후속 명령 버튼을 켜고 목표를 지정하여 기존 명령 뒤에 유효한 이동·임무를 예약합니다.                       |

## 이번 입력 변경 검증

리플레이의 별도 렌더러도 동일 등록 체계와 프로필을 사용한다. P는 재생/일시정지, 쉼표·마침표는 기존 재생 속도 목록, 방향키는 카메라, 대괄호는 한 프레임 탐색, Shift+대괄호는 100프레임 탐색이다. 옛 하드코딩 Space/방향키 탐색 경로를 남기지 않았다. 지도처럼 Space는 지형 보기, H는 현재 컨텍스트의 전체 표를 연다. 한글 조합·입력·모달·키 반복·keyup·포커스 상실을 검사하며 군사 명령은 받지 않는다.

리플레이 변경 후 `outputs/repair-input-tests-replay-final.log`의 **15파일 351테스트 통과**가 최신 입력 검증 결과이다. 아래 12파일 결과를 더해 테스트 수를 세지 않는다. 이전 중간 타입 오류를 수정한 뒤 다시 실행한 `tsc --noEmit`은 `TSC_EXIT=0`, 입력 관련 파일 ESLint는 `ESLINT_EXIT=0`으로 종료했다. 재검사 로그는 `outputs/repair-input-tsc-confirmed.log`와 `outputs/repair-input-eslint-confirmed.log`이다.

`outputs/repair-input-tests-final.log`: InputHandler, ModernInput, 새 프로필 마이그레이션, 키 충돌, 입력 중 키 캡처, 제스처, UserSettings, 설정 값/탭/그래픽/디스플레이/오디오의 **12파일 312테스트 통과**. 범위 ESLint와 전체 TypeScript 검사는 통과했다. 추가 검사는 최신 커서만 미리보기, 우클릭 이전 hover 취소, 정지/취소 구분, modal/repeat/blur, 원본 Ctrl 클릭, 저장 백업·멱등성·충돌 거절·저장 용량 오류를 포함한다. 이 수치는 브라우저에서 실제 군사 이동·훈련이 완료되었다는 증거로 사용하지 않는다.

추가 실제 화면 검증에서 `Equal`/`Minus`가 코드명으로 표시되어 줌 키를 알아보기 어려웠다. 공통 `formatKeyForDisplay()`는 `+`/`−`, 화살표, 구두점, 완전한 Ctrl/Alt/Shift/Meta 조합과 숫자패드 구분을 표시하도록 고쳤다. `repair-keylabel-tests.log`는 관련 **5파일 32테스트 통과**, `repair-keylabel-eslint.log`는 exit 0이다. 이 32개는 앞 검사와 대부분 중복이므로 합산하지 않는다.

화면 안 전체 부대를 선택하는 F는 UI 선택을 네트워크 Intent 최대 32개와 구분한다. `ModernSelectionCommands.ts`는 ID를 중복 없이 코드포인트 순으로 나눠 전달하고, UI 경로 미리보기를 최대 8개씩 요청하며 오래된 커서 응답을 폐기한다. `repair-selection-tests.log`의 **1파일 6테스트 통과**는 37개 선택의 32+5 명령, 역순 비동기 응답, 동시 요청 상한과 취소·오류를 검증한다. 실제 군사 명령의 권한·통행·인력 검증은 core 경로를 계속 사용한다.

## 실제 브라우저 입력 확인

Playwright CLI의 독립 `repair-profile`/`repair-fresh` 프로필로 정상 메뉴를 사용했다. 소스 상태를 주입하거나 개발 콘솔로 명령·교육 완료를 생성하지 않았다. 아래 상태 기록은 공개 GameView·HUD·변환 좌표·브라우저 저장소의 읽기 전용 확인이다. 자산 `index-CcbW69fK.js`, 이후 공통 도움말·키 표시 수정 자산 `index-ChM3l3MJ.js`에서 확인했으며 최종 커밋/전체 플레이 검증은 별도 복구 보고서에 기록한다.

| 확인              | 실제 결과와 증거                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 옛 키 설정        | Classic 설정 UI에서 Q/E/W 옛 기본, 이동 X 사용자 변경, 수송 V 사용자 변경을 실제 키 캡처로 저장한 뒤 현대 메뉴로 시작했다. v2 프로필은 Q/W/E를 군종으로 확보하고 X 충돌을 해제·안내했으며 V와 원본 raw 백업을 보존했다. `repair-profile-final-migrated.log`, `repair-profile-migration-notices-details.log`, `repair-legacy-migration-notices.png`. 이 fixture는 저장 형식 호환 검증이며 과거 사용자의 실제 프로필을 가져온 것은 아니다. |
| 새·옛 Q/W/E       | 각각 해군→공군→육군으로 바뀌며 카메라 scale/offset·실행 중 명령이 변하지 않았다. `repair-profile-qwe.log`, `repair-fresh-qwe.log`. 군종 선택으로 자동 출정하지 않았다.                                                                                                                                                                                                                                                                   |
| 재지정            | 게임 설정에서 육군 Q를 Z로 바꾸면 HUD에 즉시 Z가 표시됐다. E 후 Q는 공군을 유지하고 Z는 육군을 선택했다. `repair-fresh-rebind-setting.log`, `repair-fresh-rebind-dispatch.log`.                                                                                                                                                                                                                                                          |
| 카메라·선택       | F는 화면 안 육군 두 개를 선택했다. C 애니메이션 완료 후 부대 좌표는 화면 중심 근처에 붙었다. 휠 −120은 scale 8→10, 휠 +120은 10→8.3333, −키는 축소했으며 선택과 일시정지 tick을 유지했다. `repair-fresh-visible-center.log`, `repair-fresh-wheel.log`.                                                                                                                                                                                   |
| Classic 격리      | 정상 혼자 하기 World/기본 400봇·72국가에서 실제 지도 클릭으로 스폰했다. 현대 패널은 없고 Q/E 줌·W 카메라가 유지되며 저장된 현대 Z는 개입하지 않았다. `repair-classic-keys.log`. 작은 섬 스폰의 육상 확장은 이 검사에서 완료하지 않았다.                                                                                                                                                                                                  |
| 게임 내 도움말    | H가 숨은 메뉴의 inline 도움말만 여는 결함을 실제로 재현했다. 공통 원본 모달을 게임 위에 표시한 수정 후 전체 현대 표, 검색, 모드·컨텍스트를 확인했다. 반복 열기에도 overlay는 1개이며 닫으면 제거되고 게임 URL은 유지된다. `repair-profile-help-hidden.log`, `repair-modern-help-full.log`, `repair-modern-full-controls.png`.                                                                                                            |
| 한글 입력 후 복귀 | 검색에 대한민국/육군 한글 문자열을 입력하고 qwe·방향키를 눌러도 군종·카메라가 변하지 않았다. Esc로 창을 닫은 뒤 W 군종 선택이 다시 작동했다. `repair-modern-korean-focus.log`, `repair-classic-korean-focus.log`. 이는 실제 검색 UI의 Unicode 입력이며 OS의 한글 IME 전환 검증은 아니다. 조합 중 guard는 자동 검사로만 검증했다.                                                                                                         |
| 짧은 지역 챕터    | 가이드의 실제 챕터 선택으로 전용 시나리오에 진입했다. 독립 지휘권과 동일 인구의 실제 상태를 확인하는 두 단계는 v4 practiced, skipped 0으로 저장됐고 294세력의 시작 총인구가 모두 1,000,000이었다. `repair-guide-regions-complete.log`. 별도 인구 손실·AI 정보·육해공 실습 전체의 완료를 대신하는 증거는 아니다.                                                                                                                          |

공개 계정/서버 API에 접속하지 못해 메인 화면에 기존 연결 오류 창이 떴다. 정상 닫기 버튼으로 닫은 뒤 로컬 싱글플레이와 설정·도움말 검증을 계속했다. 온라인 계정·초대방 연결 성공을 이 검사로 주장하지 않는다.

최종 후보 `index-En8mO27a.js`에서 추가로 range 포커스 중 방향키가 공격 비율을 바꾸지 않고 카메라를 움직이는 결함, 육군에 Alt+R을 지정하면 그래픽 초기화와 동일한 실효 키가 저장되는 결함을 재현했다. 키 편집·실효 표·dispatch 모두 조합 키로 비교하도록 정리하고 range에는 브라우저 입력을 우선한다. 이미 충돌한 현대 v2 프로필은 `settings.input.v2.before-effective-conflicts`에 원본을 백업하고 미지정·충돌 이유를 보여준다. 원본 Classic 저장값은 유지한다.

수정 후보 `index-B9wnt1GH.js`의 실제 UI에서 range 방향키는 공격 비율 20→21만 바꾸고 카메라·일시정지 tick 5를 유지했다. 지도 클릭 후 방향키 이동은 다시 동작했다. Alt+R 편집은 거절되어 기존 Z가 설정과 저장값에 유지됐고 가이드·HUD·도움말도 Z를 표시했다. 독립 프로필에서 다시 Classic 키 UI로 옛 Q/E/W와 사용자 X/V를 저장한 뒤 현대 메뉴로 시작하여 Q/W/E의 군종 전환, 카메라·명령 유지, X 충돌 안내, V·원문 백업 보존을 확인했다. 로그는 `repair-final-range-{focused-before,after}.log`, `repair-final-gfx-conflict-{before,after}.log`, `repair-final-legacy-{ui-setup,migrated-qwe}.log`, `repair-final-rebind-{help,guide}.log`이다.

터치 추가 선택은 실제 선택 수가 증가할 때만 실습에 기록한다. 목표 지정 중 손가락 이동은 선택을 바꾸지 않고 실제 유효 경로 미리보기를 보내며, 최신 목적지와 후속 명령 토글을 동일한 명령 경로로 전달한다. 이 추가 변경의 `repair-touch-input-tests.log`는 **5파일 119테스트 통과**, 범위 ESLint는 exit 0이다. 앞 검사와 중복되므로 합산하지 않는다. 실제 태블릿 실습과 최종 전체 검사는 복구 보고서에 별도 기록한다.

## 최신 후보의 실제 터치 실습

2026-10-06 KST, `http://127.0.0.1:19004`, core fingerprint `64a4a035a0e4`, client `index-1gRSTbfm.js`에서 정상 메인 메뉴 → 현대 국가 모드 → 대한민국 → 현대 조작 연습으로 시작했다. 820×900 Chromium의 CDP native touch emulation과 두 손가락 입력을 사용했다. 전용 연습의 공통 자금 4,000,000금과 인구 1,000,000명은 일반 경기 시작 자금과 구별한다. 아래 기록은 실제 화면 조작과 공개 GameView·HUD·진행 저장의 읽기 전용 관찰이다. 명령·시뮬레이션·교육 상태를 주입하거나 건너뛰지 않았다.

| 확인                | 실제 결과                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 작은 화면 진입      | 1036×953에서 가이드 챕터 버튼이 실제 클릭되고 새 Q/W/E는 카메라·기존 명령을 바꾸지 않았다. 기존 부모 stacking context에 가려지던 버튼 수정의 실제 확인이다.                                                                                                                                                                                                                                                         |
| 카메라·군종·선택    | 두 손가락 이동·확대로 실제 cameraMoves와 zoomChanges가 증가했다. 군종 버튼으로 해군→공군→육군을 선택했고 출정은 없었다. 한 손가락 상자 선택 뒤 추가 선택 토글과 다른 부대 터치로 두 육군이 선택됐다.                                                                                                                                                                                                                |
| 목표 미리보기       | 목표 지정 → 한 손가락 드래그 동안 선택이 유지되고 유효한 실제 경로가 나타났다. 손을 뗀 뒤에도 두 부대의 command는 null이었다. 명령 확정 버튼이 별도로 보였다.                                                                                                                                                                                                                                                       |
| 이동·후속 명령      | 화면 명령 확정으로 실제 moving 상태가 시작됐다. 후속 명령 토글 → 목표 지정 → 명령 확정으로 각 부대에 대기열 1개가 수락됐다. tick6522→6540의 위치는 tile605707→595707, pathIndex11→16이며 현재 목표577705와 후속 목표607718이 함께 남았다. 짧은 경로가 자동화 왕복 중 먼저 끝난 첫 시도는 대기열 성공으로 보고하지 않는다. 일시정지 중 목표를 준비하고 실제 재개 확인 후 확정한 재시도에서 수락된 대기열을 확보했다. |
| 화면 정지           | tick7129에 실제 이동 중인 두 육군이 tile605718에 있었다. 정지 버튼 후 tick7175에 tile593714에서 idle, command=null, queue=[]로 바뀌었다. 목적지 도착으로 가장하지 않았다.                                                                                                                                                                                                                                           |
| 유료 기지·훈련      | 육군 기지20,000금/20초는 tile611715에서 실제 완공됐다. 해당 기지에서2,500금/10초 훈련한 새 육군1,000명이 나타났다. 기존 예비 병력의 이전이므로 총인구와 육군 인력 합계가 복제되지 않았다.                                                                                                                                                                                                                           |
| 해군 기지·생산      | 유효한 해안627705를 터치하자 원래 Port 배치 규칙이631703으로 배치했다. 기존 항구3개 이후 가격1,000,000금/5초를 지불해 native 항구와 해군 기지 하나가 완공됐다. 운영 항구에서12,000금/25초 군함을 생산했고 육군99,200→99,100/해군0→100, 가용13,352와 총인구1,000,000은 유지됐다.                                                                                                                                     |
| 실제 함선·교육 완료 | native Unit12312가 tick15024부터 이동하며 여러 tick의 위치가601703→601701→601700→…로 바뀌었다. tick15068에는 목표601680에서 idle·completedMissions1이고 native 함선과 현대 상태가 같은 유닛을 가리켰다. 가이드는12개 모두 practiced, 설명0/건너뜀0을 저장했다.                                                                                                                                                      |
| 짧은 AI 과정        | 정상 챕터 선택과 실제 국가 정보·외교 → 적국의 실제 소유 육지 → 기존 정보 메뉴로 개별 AI 정보를 확인했다. `modern_ai_levels`가 practiced, 건너뜀0으로 저장됐다.                                                                                                                                                                                                                                                      |

[전체 실제 상태 기록](repair-evidence/latest64-tablet-input-state.json), [12개 실습 완료 화면](repair-evidence/latest64-tablet-commands-complete.png), [실제 위치에서 출발하는 터치 곡선 미리보기](repair-evidence/latest64-tablet-curved-preview.png)를 함께 확인할 수 있다. 곡선 화면은 완료 후 일시정지 상태에서 다시 준비한 목적지601691이며 새 command는 null이다. 이동 성공은 별도의 서로 다른 tick 상태 기록으로 확인했다. 최초 북동 해안573713은 단순 해안 미리보기와 native Port 배치 검사가 불일치해 생성이 거절됐다. 이 실패는 성공 증거에서 제외하고 별도 수정·재검증 대상으로 보고했다. 정상 남쪽 해안의 실제 완공으로 교육은 끝까지 진행됐다. 이후 locale·서식·패널 수정 빌드와 혼합하지 않으며 최종 빌드와 저장·리플레이 검증은 별도 복구 보고서에 기록한다.

## 실제 저장 파일의 리플레이 조작 검증

`index-CYaFHMjv.js` / core `84bebb823344` 후보에서 정상 메뉴의 저장 관리로 공개 UI가 내보낸 tick47 저장 파일을 가져와 리플레이 복습을 실행했다. 820×900 화면의 저장 버튼은 y802.67에 표시되고 실제 클릭 대상이 버튼이었다. 리플레이는 정상 ready 상태로 47프레임을 읽었다. Q/W/E는 군사 명령과 카메라를 변경하지 않았고, 방향키는 카메라 이동, +/−는 줌, [/]는 한 프레임, Shift+[ ]는 범위 내 100프레임 이동, P는 재생·정지, ,/.은 배속 변경으로 작동했다. 마지막 프레임에는 인간 육군 두 부대의 실제 이동 명령과 후속 명령이 유지됐다.

H 도움말 검색에 한국어를 입력한 상태에서 Q/W/E, 방향키, [ ], P, ,/.을 입력해도 프레임·배속·카메라는 바뀌지 않았다. Esc로 창을 닫은 다음 방향키는 다시 카메라를 이동했다. 이는 브라우저의 한국어 문자 입력 검증이며 운영체제의 실제 한글 IME 조합 검증은 실행하지 않았다. [상태 기록](repair-evidence/latest84-replay-input-state.json)과 [복습 화면](repair-evidence/latest84-replay-view.png)을 제공한다.

이 후보의 H 표에 `BracketLeft` 등 코드명이 남는 별도 표시 결함을 실제로 재현했다. HelpModal의 키 이름 fallback을 공통 `formatKeyForDisplay()`로 연결해 대괄호·숫자패드·재지정 표기가 설정과 같아지게 수정했다. 실제 표 렌더링과 saved Ctrl+J 재지정을 확인하는 신규 회귀 2개를 포함해 `repair-help-label-tests.log`의 **4파일 11테스트 통과**, 범위 ESLint exit0이다. 이전 결과와 합산하지 않으며 후속 최종 빌드의 화면 검증은 별도로 기록한다. 작업 중 배포가 옛 리플레이 JS 파일을 제거한 첫 진입 실패는 성공 검증에서 제외했다.

최종 `index-BQUAIhRR.js` / core `84bebb823344` / 저장 빌드 `01021f0de686da860e30a6c96f8a06a16e5771c91d10a30d2a24db95027a5a29`에서 공개 UI가 내보낸 tick48 저장을 다시 가져와 ready48프레임을 확인했다. H의 대괄호·Shift 조합·숫자패드 표기가 실제 화면에서 수정됐고, P 재생 후 frame0→2에서 다시 정지했다. [ ]로 frame33↔47을 왕복하자 육군1466/1467은 idle577705/579705에서 moving579706/581706으로 바뀌었고, issued36 이동 명령과 issued44 후속 명령도 그대로 복원됐다. frame46과47은 같은 tile이므로 두 프레임만으로 이동을 주장하지 않았다.

[최종 실제 상태 기록](repair-evidence/release-replay-input-state.json), [최종 H 전체 조작표 화면](repair-evidence/release-replay-shared-keys.png)을 제공한다. 창의 custom element host에 대한 첫 자동화 visible 대기는 fixed 내부 모달과 박스가 달라 타임아웃이었고, 이후 실제 모달 표·키 입력을 정상 확인했다. 이는 게임의 명령 실패로 집계하지 않았다. 검증이 끝난 리플레이는 정지한 뒤 브라우저를 종료했다. 최종 전체 검사·성능 수치는 별도 복구 보고서의 빌드별 기록을 따른다.

실물 태블릿과 OS 한글 IME 전환은 실행하지 않았다. 검색 UI의 실제 Unicode 한글 입력과 composing guard 자동 검사만 해당 증거 범위다.
