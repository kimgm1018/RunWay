// Run with Groovy 2.4: groovy infra/jenkins/tests/WatchCiTest.groovy
// Execute the watch parts of the actual pipelines with recorded Jenkins steps. Shell commands are not run.
jenkinsLoader = new GroovyClassLoader(this.class.classLoader)
jenkinsLoader.parseClass('package org.jenkinsci.plugins.workflow.steps\nclass FlowInterruptedException extends RuntimeException {}')
interrupted = jenkinsLoader.loadClass('org.jenkinsci.plugins.workflow.steps.FlowInterruptedException')

REFERENCE = '/home/jenkins/agent/caches/runway-git-reference.git'
WATCH_PATHS = ['/wear/', '/infra/jenkins/', '/frontend/android/app/debug.keystore']

// failOn: shell command fragment that fails. checkoutFailure: exception for checkouts using the reference.
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
            if (clone && opts.checkoutFailure) throw opts.checkoutFailure
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
        archiveArtifacts: { Map args -> result.events << 'archive' },
        error: { message -> throw new AssertionError(message.toString()) },
        stage: { String name, Closure body -> result.stages << name; body() },
    ]
}

def runCi(Map opts) {
    def result = [stages: [], events: [], checkouts: [], error: null]
    def steps = baseSteps(result, opts)
    def context = new Binding(steps + [
        env: [gitlabMergeRequestIid: '481', gitlabTargetBranch: 'dev', gitlabMergeRequestLastCommit: 'source',
              gitlabMergeRequestTitle: 'watch CI', BUILD_NUMBER: '1', BUILD_TAG: 'test-build'],
        currentBuild: [currentResult: 'SUCCESS'], none: 'none',
        agent: { ignored -> }, options: { Closure ignored -> },
        pipeline: { Closure body -> body() }, stages: { Closure body -> body() },
        steps: { Closure body -> body() }, script: { Closure body -> body() },
        node: { String label, Closure body -> body() }, dir: { String path, Closure body -> body() },
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
    def result = [stages: [], events: [], checkouts: [], error: null]
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

def assertOrder(List events, List expected, String name) {
    def positions = expected.collect { events.indexOf(it) }
    assert !positions.contains(-1): "${name}: missing ${expected[positions.indexOf(-1)]} in ${events}"
    assert positions == positions.sort(false): "${name}: wrong order ${events}"
}

// 1. 통합 CI: 워치만 sparse + 참조 저장소로 받고, 세 단계 뒤 데몬을 종료한다.
def ci = runCi(files: ['wear/app/src/main/java/com/runway/watch/MainActivity.kt'])
assert ci.error == null: ci.error
assert ci.checkouts.size() == 2
assert ci.checkouts[0] == [reference: null, sparse: null]: 'Prepare keeps the full checkout'
assert ci.checkouts[1] == [reference: REFERENCE, sparse: WATCH_PATHS]
assert ci.stages.containsAll(['Watch Checkout', 'Watch Tests', 'Watch Lint', 'Watch APK Build',
                              'Watch Gradle Stop', 'Watch Reports'])
assertOrder(ci.events, [updateCommand(), stageCommand('test'), stageCommand('lint'), stageCommand('apk'),
                        stageCommand('stop'), 'archive'], 'ci success')
assert !ci.events.contains(removeCommand())

// 2. 다른 영역 체크아웃은 기존과 같다.
def common = runCi(files: ['infra/jenkins/Jenkinsfile.ci'])
assert common.error == null: common.error
assert common.checkouts.count { it.reference == REFERENCE } == 1: 'only watch uses the reference'
assert common.checkouts.findAll { it.reference == null }.every { it.sparse == null }

// 3. 실패한 단계 뒤 단계는 건너뛰고 데몬 종료·보고서 보관은 실행한다.
def lintFailure = runCi(files: ['wear/build.gradle.kts'], failOn: '--stage lint')
assert lintFailure.error != null
assert !lintFailure.events.contains(stageCommand('apk'))
assertOrder(lintFailure.events, [stageCommand('lint'), stageCommand('stop'), 'archive'], 'ci lint failure')

// 4. 참조 저장소 체크아웃이 실패하면 지우고 참조 없이 한 번 더 받는다.
def broken = runCi(files: ['wear/build.gradle.kts'], checkoutFailure: new RuntimeException('bad alternate'))
assert broken.error == null: broken.error
assert broken.checkouts.drop(1) == [[reference: REFERENCE, sparse: WATCH_PATHS], [reference: null, sparse: WATCH_PATHS]]
assertOrder(broken.events, [removeCommand(), updateCommand(), stageCommand('test')], 'ci reference fallback')

// 5. 중단·시간 초과는 다시 받지 않고 그대로 실패한다.
def aborted = runCi(files: ['wear/build.gradle.kts'], checkoutFailure: interrupted.newInstance())
assert interrupted.isInstance(aborted.error)
assert aborted.checkouts.size() == 2 && !aborted.events.contains(removeCommand())
assert !aborted.events.contains(stageCommand('test'))
println 'Watch CI: 5 scenarios passed'

// 6. master 워치 APK 작업도 같은 체크아웃·데몬 정리 방식을 사용한다.
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
