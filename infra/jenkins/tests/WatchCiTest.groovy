// Run with Groovy 2.4: groovy infra/jenkins/tests/WatchCiTest.groovy
// Execute the watch and shared reference-checkout parts of the actual pipelines with recorded Jenkins steps. Shell commands are not run.
jenkinsLoader = new GroovyClassLoader(this.class.classLoader)
jenkinsLoader.parseClass('package org.jenkinsci.plugins.workflow.steps\nclass FlowInterruptedException extends RuntimeException {}')
interrupted = jenkinsLoader.loadClass('org.jenkinsci.plugins.workflow.steps.FlowInterruptedException')

REFERENCE = '/home/jenkins/agent/caches/runway-git-reference.git'
WATCH_PATHS = ['/wear/', '/infra/jenkins/', '/frontend/android/app/debug.keystore']
BACKEND_PATHS = ['/backend/', '/docs/design/db/', '/ai/service/tests/fixtures/', '/infra/jenkins/']

// failOn: shell command fragment that fails. checkoutFailure: exception for checkouts using the reference.
// failSparse: only reference checkouts with these sparse paths fail (default: every reference checkout).
// missingUpdateScript: the checked-out code predates infra/jenkins/update-git-reference.sh.
def baseSteps(Map result, Map opts) {
    return [
        deleteDir: { -> result.events << 'deleteDir' },
        checkout: { Map args ->
            def ext = args.extensions ?: []
            def clone = ext.find { it.$class == 'CloneOption' }
            def sparse = ext.find { it.$class == 'SparseCheckoutPaths' }
            result.checkouts << [reference: clone?.reference,
                                 sparse: sparse?.sparseCheckoutPaths?.collect { it.path }]
            result.events << 'checkout'
            def targeted = opts.failSparse == null || (sparse?.sparseCheckoutPaths?.collect { it.path } ?: []) == opts.failSparse
            if (clone && opts.checkoutFailure && targeted) throw opts.checkoutFailure
        },
        sh: { args ->
            if (args instanceof Map && args.returnStdout) {
                if (args.script.contains('git diff')) return opts.files.join('\u0000')
                return args.script.contains('rev-parse HEAD') ? 'source\n' : 'target\n'
            }
            def command = args.toString()
            result.events << command
            if (opts.failOn && command.contains(opts.failOn)) throw new RuntimeException("failed: ${command}")
            return 0
        },
        echo: { message -> }, junit: { Map args -> [failCount: 0] },
        fileExists: { String path -> !(opts.missingUpdateScript && path == 'infra/jenkins/update-git-reference.sh') },
        // Record the working directory so a writeFile moved into dir('backend') would break the init-script path.
        writeFile: { Map args ->
            def path = (result.dirs + [args.file]).join('/')
            result.events << "writeFile ${path}".toString()
            result.written[path] = args.text
        },
        archiveArtifacts: { Map args -> result.events << 'archive' },
        error: { message -> throw new AssertionError(message.toString()) },
        stage: { String name, Closure body -> result.stages << name; body() },
    ]
}

def runCi(Map opts) {
    def result = [stages: [], events: [], checkouts: [], written: [:], dirs: [], error: null]
    def steps = baseSteps(result, opts)
    def context = new Binding(steps + [
        env: [gitlabMergeRequestIid: '481', gitlabTargetBranch: 'dev', gitlabMergeRequestLastCommit: 'source',
              gitlabMergeRequestTitle: 'watch CI', BUILD_NUMBER: '1', BUILD_TAG: 'test-build'],
        currentBuild: [currentResult: 'SUCCESS'], none: 'none',
        agent: { ignored -> }, options: { Closure ignored -> },
        pipeline: { Closure body -> body() }, stages: { Closure body -> body() },
        steps: { Closure body -> body() }, script: { Closure body -> body() },
        node: { String label, Closure body -> body() }, dir: { String path, Closure body -> result.dirs << path; try { body() } finally { result.dirs.remove(result.dirs.size() - 1) } },
        timeout: { Map args, Closure body -> body() },
        gitlabCommitStatus: { Map args, Closure body -> body() }, updateGitlabCommitStatus: { Map args -> },
        withCredentials: { List args, Closure body -> body() }, withEnv: { List args, Closure body -> body() },
        string: { Map args -> args },
        parallel: { Map branches -> branches.values().each { it() } },
    ])
    try {
        new GroovyShell(jenkinsLoader, context).parse(new File('infra/jenkins/Jenkinsfile.ci')).run()
    } catch (Throwable err) {
        result.error = err
    }
    return result
}

def runMasterApk(Map opts) {
    def result = [stages: [], events: [], checkouts: [], written: [:], dirs: [], error: null]
    def steps = baseSteps(result, opts)
    def captured = [:]
    def context = new Binding(steps + [
        env: [:], currentBuild: [:],
        agent: { ignored -> }, label: { ignored -> }, options: { Closure ignored -> },
        skipDefaultCheckout: { ignored -> }, disableConcurrentBuilds: { -> },
        timeout: { Map ignored -> }, buildDiscarder: { ignored -> }, logRotator: { Map ignored -> },
        // Declarative runs post after stages even when a stage fails.
        pipeline: { Closure body ->
            body()
            try { captured.stages() } finally { captured.post() }
        },
        stages: { Closure body -> captured.stages = body },
        post: { Closure body -> captured.post = body },
        always: { Closure body -> body() },
        steps: { Closure body -> body() }, script: { Closure body -> body() },
    ])
    try {
        new GroovyShell(jenkinsLoader, context).parse(new File('infra/jenkins/Jenkinsfile.watch-apk')).run()
    } catch (Throwable err) {
        result.error = err
    }
    return result
}

// Recorded commands are Strings; GString never equals String in list lookups.
def stageCommand(String stage) { "sh infra/jenkins/build-watch-apk.sh --stage ${stage}".toString() }
def updateCommand() { "sh infra/jenkins/update-git-reference.sh '${REFERENCE}'".toString() }
def removeCommand() { "rm -rf '${REFERENCE}'".toString() }
// Jenkinsfile.ci renames the reference first so an interrupted delete never leaves a half-removed reference in place.
def ciRemoveCommand() {
    "rm -rf '${REFERENCE}.broken' && if [ -e '${REFERENCE}' ]; then mv '${REFERENCE}' '${REFERENCE}.broken'; fi && rm -rf '${REFERENCE}.broken'".toString()
}
GRADLE_COMMAND = 'sh ./gradlew --no-daemon --build-cache --init-script ../ci-no-test-cache.gradle clean build'
def mergeEvent(List events) { events.find { it.contains('merge --no-ff') } }

def assertOrder(List events, List expected, String name) {
    def positions = expected.collect { events.indexOf(it) }
    assert !positions.contains(-1): "${name}: missing ${expected[positions.indexOf(-1)]} in ${events}"
    assert positions == positions.sort(false): "${name}: wrong order ${events}"
}

// 1. 통합 CI: 준비 단계는 참조 저장소로 전체를, 워치는 sparse + 참조 저장소로 받고, 세 단계 뒤 데몬을 종료한다.
def ci = runCi(files: ['wear/app/src/main/java/com/runway/watch/MainActivity.kt'])
assert ci.error == null: ci.error
assert ci.checkouts.size() == 2
assert ci.checkouts[0] == [reference: REFERENCE, sparse: null]: 'Prepare keeps the full checkout'
assert ci.checkouts[1] == [reference: REFERENCE, sparse: WATCH_PATHS]
assert ci.stages.containsAll(['Watch Checkout', 'Watch Tests', 'Watch Lint', 'Watch APK Build',
                              'Watch Gradle Stop', 'Watch Reports'])
assertOrder(ci.events, [updateCommand(), stageCommand('test'), stageCommand('lint'), stageCommand('apk'),
                        stageCommand('stop'), 'archive'], 'ci success')
assert !ci.events.contains(ciRemoveCommand())

// 2. 준비·워치·백엔드만 참조 저장소를 쓰고 모바일·AI·Route 체크아웃은 기존과 같다.
def common = runCi(files: ['infra/jenkins/Jenkinsfile.ci'])
assert common.error == null: common.error
assert common.checkouts.findAll { it.reference == REFERENCE } ==
    [[reference: REFERENCE, sparse: null], [reference: REFERENCE, sparse: BACKEND_PATHS],
     [reference: REFERENCE, sparse: WATCH_PATHS]]
assert common.checkouts.findAll { it.reference == null }.every { it.sparse == null }

// 3. 실패한 단계 뒤 단계는 건너뛰고 데몬 종료·보고서 보관은 실행한다.
def lintFailure = runCi(files: ['wear/build.gradle.kts'], failOn: '--stage lint')
assert lintFailure.error != null
assert !lintFailure.events.contains(stageCommand('apk'))
assertOrder(lintFailure.events, [stageCommand('lint'), stageCommand('stop'), 'archive'], 'ci lint failure')

// 4. 참조 저장소 체크아웃이 실패하면 지우고 참조 없이 한 번 더 받는다.
def broken = runCi(files: ['wear/build.gradle.kts'], checkoutFailure: new RuntimeException('bad alternate'),
                   failSparse: WATCH_PATHS)
assert broken.error == null: broken.error
assert broken.checkouts.drop(1) == [[reference: REFERENCE, sparse: WATCH_PATHS], [reference: null, sparse: WATCH_PATHS]]
assertOrder(broken.events.drop(broken.events.indexOf(ciRemoveCommand())), [ciRemoveCommand(), updateCommand(), stageCommand('test')],
            'ci reference fallback')

// 5. 중단·시간 초과는 다시 받지 않고 그대로 실패한다.
def aborted = runCi(files: ['wear/build.gradle.kts'], checkoutFailure: interrupted.newInstance(),
                    failSparse: WATCH_PATHS)
assert interrupted.isInstance(aborted.error)
assert aborted.checkouts.size() == 2 && !aborted.events.contains(ciRemoveCommand())
assert !aborted.events.contains(stageCommand('test'))

// 6. 백엔드 검사도 sparse + 참조 저장소로 받고, 손상 시 참조 없이 한 번 더 받는다. 중단은 다시 받지 않는다.
def backend = runCi(files: ['backend/build.gradle'])
assert backend.error == null: backend.error
assert backend.checkouts == [[reference: REFERENCE, sparse: null], [reference: REFERENCE, sparse: BACKEND_PATHS]]
assert backend.events.count(updateCommand()) == 2
def backendTail = backend.events.drop(backend.events.lastIndexOf(updateCommand()))
assertOrder(backendTail, [updateCommand(), mergeEvent(backendTail), 'writeFile ci-no-test-cache.gradle', GRADLE_COMMAND, 'archive'],
            'backend success')
// 테스트 캐시 차단은 검사 대상 build.gradle이 아니라 Jenkinsfile이 만든 init script로 강제한다.
def initScript = backend.written['ci-no-test-cache.gradle']
assert initScript.startsWith('allprojects {') && initScript.contains('tasks.withType(Test).configureEach') &&
    initScript.contains('outputs.doNotCacheIf(')
def backendBroken = runCi(files: ['backend/build.gradle'], checkoutFailure: new RuntimeException('bad alternate'),
                          failSparse: BACKEND_PATHS)
assert backendBroken.error == null: backendBroken.error
assert backendBroken.checkouts.drop(1) ==
    [[reference: REFERENCE, sparse: BACKEND_PATHS], [reference: null, sparse: BACKEND_PATHS]]
assertOrder(backendBroken.events.drop(backendBroken.events.indexOf(ciRemoveCommand())),
            [ciRemoveCommand(), updateCommand(), GRADLE_COMMAND, 'archive'], 'backend reference fallback')
def backendAborted = runCi(files: ['backend/build.gradle'], checkoutFailure: interrupted.newInstance(),
                           failSparse: BACKEND_PATHS)
assert interrupted.isInstance(backendAborted.error)
assert !backendAborted.events.contains(ciRemoveCommand())
assert !backendAborted.events.any { it.contains('gradlew') }

// 7. 준비 단계 참조 저장소가 손상돼도 참조 없이 전체를 다시 받아 진행한다.
def prepareBroken = runCi(files: ['README.md'], checkoutFailure: new RuntimeException('bad alternate'), failSparse: [])
assert prepareBroken.error == null: prepareBroken.error
assert prepareBroken.checkouts == [[reference: REFERENCE, sparse: null], [reference: null, sparse: null]]
def prepareAborted = runCi(files: ['README.md'], checkoutFailure: interrupted.newInstance(), failSparse: [])
assert interrupted.isInstance(prepareAborted.error)
assert prepareAborted.checkouts.size() == 1 && !prepareAborted.events.contains(ciRemoveCommand())

// 8. 갱신 스크립트가 없는 오래된 MR 코드도 갱신만 건너뛰고 검사한다.
def oldBranch = runCi(files: ['backend/build.gradle'], missingUpdateScript: true)
assert oldBranch.error == null: oldBranch.error
assert !oldBranch.events.contains(updateCommand())
assert oldBranch.events.contains(GRADLE_COMMAND)

// 9. 백엔드 테스트가 읽는 DB 스키마 정본·W07 fixture만 바뀌어도 백엔드를 검사한다.
['docs/design/db/schema.sql', 'ai/service/tests/fixtures/w07_ai06/case.w07.json'].each { path ->
    def readByTests = runCi(files: [path])
    assert readByTests.error == null: readByTests.error
    assert readByTests.events.contains(GRADLE_COMMAND): path
}
def docsOnly = runCi(files: ['docs/design/api/runs.md'])
assert !docsOnly.events.contains(GRADLE_COMMAND)
println 'Watch CI: 9 scenarios passed'

// 10. master 워치 APK 작업도 같은 체크아웃·데몬 정리 방식을 사용한다.
def master = runMasterApk(files: [])
assert master.error == null: master.error
assert master.checkouts == [[reference: REFERENCE, sparse: WATCH_PATHS]]
assertOrder(master.events, [updateCommand(), stageCommand('test'), stageCommand('lint'), stageCommand('apk'),
                            'archive'], 'master success')
assert master.events.find { it.contains('--stage stop') } != null
assert master.events.indexOf(master.events.find { it.contains('--stage stop') }) > master.events.indexOf(stageCommand('apk'))

def masterFailure = runMasterApk(files: [], failOn: '--stage test')
assert masterFailure.error != null
assert !masterFailure.events.contains(stageCommand('lint'))
assert masterFailure.events.find { it.contains('--stage stop') } != null: 'post stops the daemon after failure'

def masterBroken = runMasterApk(files: [], checkoutFailure: new RuntimeException('bad alternate'))
assert masterBroken.error == null: masterBroken.error
assert masterBroken.checkouts == [[reference: REFERENCE, sparse: WATCH_PATHS], [reference: null, sparse: WATCH_PATHS]]
assertOrder(masterBroken.events, [removeCommand(), updateCommand()], 'master reference fallback')

def masterAborted = runMasterApk(files: [], checkoutFailure: interrupted.newInstance())
assert interrupted.isInstance(masterAborted.error)
assert masterAborted.checkouts.size() == 1 && !masterAborted.events.contains(removeCommand())
println 'Watch APK: 4 scenarios passed'
