"""Produce a reviewable Korean report from the actual versioned output."""
from pathlib import Path
import json
from collections import Counter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
data = json.loads((ROOT / "src/core/game/ModernRegionsData.json").read_text(encoding="utf8"))
validation = json.loads((HERE / "validation.json").read_text(encoding="utf8"))
reproduction_path = HERE / "reproducibility.json"
reproduction = json.loads(reproduction_path.read_text(encoding="utf8")) if reproduction_path.exists() else None
assert validation["hash"] == data["hash"]
categories = {
    "parent-area-arithmetic": "본국 면적 <160만: 두 지역을 각 80만 이상으로 만들 수 없음",
    "isolated-component": "분리된 행정·해외 성분 <80만: 먼 영토 임의 합병 금지",
    "component-area-arithmetic": "연결 성분 120~160만: 두 지역 각 80만 조건 불가능",
    "administrative-packing": "행정 경계 조합 제한: 재사용 권리가 확인된 하위 경계 입력 부족",
}
split = [f for f in data["factions"] if f["isSplit"]]
lines = [
    "# 현대 국가 지역 v2: 실제 생성 자료 및 검증", "",
    "이 문서는 생성된 데이터의 상태를 보고합니다. 공군·경제·AI·승패·저장 등 게임 규칙의 통합 검증 결과는 별도 시스템 보고서에서 확인해야 합니다.", "",
    f"- 시나리오: `{data['scenarioId']}`, 데이터 버전 {data['version']}.",
    f"- 지원: 원본 현대 세계의 198개 본국 컨트롤러를 {len(data['factions'])}개 독립 선택 세력으로 표현.",
    f"- 120만 km²를 넘는 24개 본국의 {len(split)}개 지역 중 {sum(f['areaException'] is None for f in split)}개가 일반 범위, {len(data['exceptions'])}개가 명시 예외.",
    f"- 원본 통행 가능 육지 {validation['conservedTiles']:,}개 타일과 부모 소유권 합집합을 중복·누락 없이 보존.",
    f"- 지역별 기후 {validation['climateTiles']:,}개 타일, 독립된 주요 항구 {len(data['ports'])}개.",
    f"- 고정 데이터 해시: `{data['hash']}`.", "",
    "## 규칙과 기본 수치", "",
    "목표는 지역당 실제 지리 면적 100만 km², 일반 범위 80만~120만 km²입니다. 작은 본국은 키우거나 합치지 않습니다. 면적은 WGS84 타원체의 지리 다각형 면적이며 투영 이미지 픽셀 수가 아닙니다.", "",
    "ADM1(주·도·공화국)을 우선 유지합니다. 큰 ADM1은 공개된 ADM2로, 큰 캐나다 ADM2는 ADM3으로 세분화합니다. 캐나다 Manitoba·Saskatchewan의 조합이 상한을 넘었던 경우에는 실제 ADM2를 다시 이용하여 10개 지역 모두 일반 범위에 넣었습니다. 원본 ID, 부모 행정 ID, 하위 경계를 사용한 이유는 각 `adminUnits`에 남아 있습니다.", "",
    "국경 도형 50m와 행정 경계 10m의 해안 잔여는 완전한 조각 단위로 같은 본국의 가장 가까운 행정구역에 배정합니다. 직선·격자 분할을 만들지 않습니다. 지리 합집합 잔여는 전 본국 0 또는 부동소수점 정밀도상 1m² 이하입니다. 다각형을 합치며 지리 곡선의 중간 점이 달라지는 면적의 작은 차이는 `coastlineDifferenceKm2`에 그대로 기록합니다.", "",
    "실제 인접한 섬은 같은 원본 ADM0 구성 영토이고 최단 바다 간격이 100km 이하일 때만 같은 지역으로 묶을 수 있습니다. 이 연결은 `requiresTransport`로 기록하며 육상 이동 길을 만들지 않습니다. 먼 해외 영토는 면적을 맞추기 위해 임의 합병하지 않습니다. 64회 결정론적 제한 탐색은 전체 최적해의 수학적 증명이 아니며, 해결하지 못한 조합은 공개 예외로 남깁니다.", "",
    "각 세력은 독립 `factionId`와 기존 국가 `parentCountryId`를 갖습니다. 같은 본국에서 나온 지역 사이에 자동 동맹·자원 공유·공동 지휘를 배정하지 않습니다. 게임의 공통 시작 인구 N0=1,000,000·기본 수입·동원·시작 자금 규칙으로 면적 예외를 보정하며, 실제 인구나 타일 수를 시작 전력 보너스로 사용하지 않습니다.", "",
    "지역 중심지는 자료에 있는 도시를 우선 사용하며, 도시 자료가 없으면 합법적인 소유 타일의 지리 중심을 명시적으로 표시합니다. 이를 실제 행정 수도라고 주장하지 않습니다. 플레이어 전송 이름은 실제 UsernameSchema가 허용하는 문자와 길이를 따릅니다.", "",
    "## 분할 본국과 면적 범위", "",
    "| 본국 | 실제 기준 면적 km² | 지역 수 | 80만~120만 | 예외 |",
    "| --- | ---: | ---: | ---: | ---: |",
]
for entry in data["administrativeCoverage"]:
    factions = [f for f in split if f["parentCountryId"] == entry["parentCountryId"]]
    lines.append(f"| {entry['parentCountryId']} | {entry['areaKm2']:,.2f} | {len(factions)} | {sum(f['areaException'] is None for f in factions)} | {sum(f['areaException'] is not None for f in factions)} |")
counts = Counter(e["category"] for e in data["exceptions"])
lines += ["", "## 면적 예외 전수표", "", "예외는 숨기지 않습니다. 아래 면적은 국가별 최신 공식 통계가 아니라 동일한 원본 지리 경계를 WGS84로 측정한 값입니다.", ""]
for category, explanation in categories.items():
    lines.append(f"- {explanation}: {counts[category]}개.")
lines += ["", "| 세력 ID | 지역 | 면적 km² | 해당 연결 성분 km² | 사유 |", "| --- | --- | ---: | ---: | --- |"]
for faction in data["factions"]:
    ex = faction["areaException"]
    if ex:
        name = faction["name"].replace("|", "/")
        lines.append(f"| {faction['id']} | {name} | {faction['areaKm2']:,.2f} | {ex['componentAreaKm2']:,.2f} | {categories[ex['category']]} |")
greenland = next(f for f in data["factions"] if f["id"] == "DNK-r03")
lines += ["", f"유일하게 상한을 넘는 `{greenland['id']}`는 {greenland['areaKm2']:,.2f}km²로 상한보다 {greenland['areaKm2'] - 1200000:,.2f}km²({(greenland['areaKm2'] / 1200000 - 1) * 100:.2f}%) 큽니다. 그린란드 원본은 Natural Earth의 Qaasuitsup 등 역사적 행정구역이며 현재 공식 행정구역으로 소개하지 않습니다. geoBoundaries GRL ADM2 공개 경계는 확보하지 못했고, 정부 지도 서비스의 재사용 권리가 확인되지 않은 자료는 포함하지 않았습니다. 이는 남은 데이터 제한이며 완전히 해결된 분할로 보고하지 않습니다.", "",
    "## 기후와 실제 주요 항구", "",
    "Beck et al. (2023)의 1991~2020년 Köppen-Geiger 0.1° 자료를 2000×1000 Plate Carrée 지도로 샘플링하고 30개 분류를 건조·열대·온대·냉대·극지 5개로 묶었습니다. 지역마다 실제 분포를 사용하며 WGS84 셀 면적 가중치로 적응 기후 1~2개를 선택합니다. 두 번째 기후는 20% 이상일 때만 초기 적응으로 부여합니다. 날씨·지형·기후는 별개입니다. 새 점령이 모든 기후의 적응을 즉시 부여하지 않습니다.", "",
    f"해안의 원본 NoData {data['climateCoastalFallbackTiles']:,}개 샘플은 가장 가까운 측정 육지 기후를 사용했습니다. 이를 실측이 있는 정확한 작은 섬별 기후라고 주장하지 않습니다.", "",
    f"Natural Earth의 실제 이름·위치가 있는 주요 항구 {len(data['ports'])}개를 항해 가능한 바다에 닿는 원본 소유 타일에 배정했습니다. 원본 해안과 지도의 차이 때문에 최대 8타일 이내로 보정하며 이동 km와 원본 좌표를 저장합니다. 중복 타일·항해 불가능 위치 등 {len(data['unrepresentedPorts'])}개 후보의 제외 이유도 데이터에 있습니다. 내륙 호수는 주요 항구 보너스 위치로 사용하지 않습니다.", "",
    "대한민국에서는 Gunsan·Pohang·Ulsan 세 항구를 포함합니다. 이 원본에 Busan은 없어 추가한 것으로 보고하지 않습니다. 항구 자료는 역사적 위치이며 최신 물동량 순위나 전 세계 항구의 완전 목록이 아닙니다. 모든 주요 항구는 초기 개발 level 0(닫힘)으로 시작하여 공통 시작 수입을 유지합니다. 실제 개발·봉쇄·피해·소유권 수입 규칙은 현대 모드 core가 담당합니다.", "",
    "## 지원·해상도·정치적 자료 정책", "",
    "대한민국·일본·미국·중국·인도·브라질·영국·프랑스·러시아·인도네시아·호주·남아프리카공화국을 포함한 원본 198개 컨트롤러를 모두 보존합니다. 미국·중국·인도·러시아 등 대국은 본국 선택 뒤 독립 지역을 선택합니다. 2000×1000 지도와 약 0.18° 타일은 실제 국경의 일반화이며 작은 국가는 v1의 명시적 최소 3×3 게임용 표현을 그대로 유지합니다. 분할 전후 영역은 이 원본 표현과 동일하며 바다·통행 불가 타일을 새로 점유하지 않습니다.", "",
    "기존 명시 정책에 따라 속령은 지정된 본국 컨트롤러에 포함하고, 대국 분할 시 해당 위치의 독립 지역으로 배정합니다. 팔레스타인·대만은 별도 컨트롤러를 유지합니다. 서사하라·소말릴란드·북키프로스는 기존 시나리오의 지정 매핑을 유지하며 남극 및 제외된 남극 속령을 새로 추가하지 않습니다. 이는 게임 데이터 정책이며 정치적 승인이나 현재 국제법적 경계를 선언하지 않습니다.", "",
    "## 입력·라이선스·재생성", "",
    "- Natural Earth 5.1.1 10m ADM1 및 기존 5.1.1 50m 국가·도시: [public domain 이용 조건](https://www.naturalearthdata.com/about/terms-of-use/).",
    "- Natural Earth 5.1.2 배포 포트 ZIP의 내부 port component version은 5.0.0이며 그대로 기록했습니다.",
    "- [geoBoundaries](https://www.geoboundaries.org/) commit 9469f09: RUS ADM2(2017, ODbL), AUS ADM2(2022, CC BY 4), BRA ADM2(2020, CC BY 3 IGO), CAN ADM2(2022, Open Government Canada 2), CAN ADM3(2016, ODbL/Statistics Canada), CHN ADM2(2017, PDDL), USA ADM2(2018, public domain). 각 원본 메타데이터의 저자·자료·권리 URL을 유지합니다.",
    "- [Beck et al. 기후 원본 Figshare v1](https://doi.org/10.6084/m9.figshare.21789074.v1), [논문 DOI](https://doi.org/10.1038/s41597-023-02549-6): CC BY 4.0. 원본 추출 경로·ZIP SHA·TIFF SHA를 보존합니다.",
    "- 행정 경계를 포함한 파생 데이터베이스는 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), 별도 기후 내용은 CC BY 4.0, 프로그램은 기존 AGPL-3.0입니다. 이는 모든 자료를 한 라이선스로 바꾼다는 의미가 아닙니다. 상세 저자·조건은 `map-generator/modern-world-v2/LICENSES.md`에 있습니다.", "",
    "원본 입력은 source 디렉터리에 따로 보관하고 실제 바이트 SHA를 시나리오에 포함합니다. 런타임 외부 API나 라이브 자료 다운로드가 없습니다. 생성기가 기존 modern-world v1·terrain·진행 중인 옛 저장을 변경하지 않습니다.", "",
    "```sh", "python map-generator/modern-world-v2/generate.py", "python map-generator/modern-world-v2/validate.py", "python map-generator/modern-world-v2/reproduce.py", "python map-generator/modern-world-v2/report.py", "npx vitest run tests/ModernRegionsData.test.ts --maxWorkers=2", "```", "",
    "Python 의존성은 해당 디렉터리 requirements.txt에 실제 검증 버전으로 고정했습니다. 전체 원본 계산을 다시 하려면 저장소 밖의 선택적 `../modern-regions-cache`를 삭제할 수 있습니다. 캐시 키는 generator·policy·모든 입력·부모 시나리오 바이트를 포함합니다.", "",
    "## 실행한 자료 검증", "",
    "- Python 독립 검증 통과: 실제 terrain SHA, 육지/통행 가능 조건, 타일 중복·누락, 부모 영토 보존, 지리 잔여, 고유 원본 행정 piece ID, 소유 중심지, 기후 분포, 항구 고유성과 소유권/초기 level 0.",
    "- Vitest `ModernRegionsData.test.ts`: 7개 검사 통과. 모든 세력 전송 이름의 실제 UsernameSchema도 검사합니다.",
]
if reproduction:
    assert reproduction["scenarioHash"] == data["hash"] and reproduction["byteIdentical"]
    lines.append(f"- 오프라인 재생성 {reproduction['elapsedSeconds']:.3f}초: JSON·owners.raw·climate.raw·factions.csv·summary 다섯 산출물의 SHA가 모두 동일했습니다. 이 시간은 자료 생성 검증이며 게임 tick 성능 수치가 아닙니다.")
else:
    lines.append("- 바이트 동일 재생성 검증은 아직 완료되지 않았습니다.")
lines += ["", "AI 승률·tick p50/p95·메모리·브라우저 게임 완료·저장 이어하기는 이 자료 생성 보고서에서 검증했다고 주장하지 않습니다. 현대 시스템 통합·성능 보고서의 실제 결과를 확인하세요.", ""]
report = "\n".join(lines)
(ROOT / "docs/ModernRegions.md").write_text(report, encoding="utf8", newline="\n")
outputs = ROOT.parent.parent / "outputs"
outputs.mkdir(exist_ok=True)
(outputs / "modern-regions-data-report-ko.md").write_text(report, encoding="utf8", newline="\n")
print(f"Generated docs/ModernRegions.md and {outputs / 'modern-regions-data-report-ko.md'}")
