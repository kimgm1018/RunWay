// Run with Groovy 2.4: groovy infra/jenkins/tests/MobileCiTest.groovy
// Parse the actual pipeline and exercise its APK decision without running Jenkins steps.
// Jenkins-only exception types used by the pipelines are stubbed so the files compile locally.
jenkinsLoader = new GroovyClassLoader(this.class.classLoader)
jenkinsLoader.parseClass('package org.jenkinsci.plugins.workflow.steps\nclass FlowInterruptedException extends RuntimeException {}')
def binding = new Binding([pipeline: { Closure ignored -> }])
def pipeline = new GroovyShell(jenkinsLoader, binding).parse(new File('infra/jenkins/Jenkinsfile.ci'))
pipeline.run()
['Jenkinsfile.mobile', 'Jenkinsfile.mobile-apk'].each { name ->
    new GroovyShell(jenkinsLoader, binding).parse(new File("infra/jenkins/${name}")).run()
}

// [name, files, forceBuild, APK, JS bundle]
def cases = [
    ['root test', ['frontend/__tests__/course.test.tsx'], false, false, false],
    ['nested test', ['frontend/src/health/__tests__/reader.test.ts'], false, false, false],
    ['multiple tests', ['frontend/__tests__/course.test.tsx', 'frontend/__tests__/communityApi.test.tsx'], false, false, false],
    ['test and docs', ['frontend/__tests__/course.test.tsx', 'docs/development/git-convention.md'], false, false, false],
    ['app source', ['frontend/src/screens/run/RunSession.tsx'], false, false, true],
    ['app JS source', ['frontend/src/data/api/client.js'], false, false, true],
    ['app root', ['frontend/App.tsx'], false, false, true],
    ['entry file', ['frontend/index.js'], false, false, true],
    ['mixed app and test', ['frontend/__tests__/course.test.tsx', 'frontend/App.tsx'], false, false, true],
    ['test fixture', ['frontend/__tests__/fixtures/data.ts'], false, false, true],
    ['source and docs', ['frontend/src/geo.ts', 'docs/development/git-convention.md'], false, false, true],
    ['dependency manifest', ['frontend/package.json'], false, true, false],
    ['dependency lock', ['frontend/pnpm-lock.yaml'], false, true, false],
    ['source and dependency', ['frontend/src/geo.ts', 'frontend/package.json'], false, true, false],
    ['Babel config', ['frontend/babel.config.js'], false, true, false],
    ['Metro config', ['frontend/metro.config.js'], false, true, false],
    ['React Native config', ['frontend/react-native.config.js'], false, true, false],
    ['app metadata', ['frontend/app.json'], false, true, false],
    ['Jest setup', ['frontend/jest.setup.js'], false, true, false],
    ['Jest config', ['frontend/jest.config.js'], false, true, false],
    ['native build', ['frontend/android/app/build.gradle'], false, true, false],
    ['native source', ['frontend/android/app/src/main/java/com/runwayhealth/MainApplication.kt'], false, true, false],
    ['source and native', ['frontend/src/geo.ts', 'frontend/android/gradle.properties'], false, true, false],
    ['asset', ['frontend/assets/images/logo.png'], false, true, false],
    ['non-code file in src', ['frontend/src/data/sample.json'], false, true, false],
    ['unknown frontend path', ['frontend/new-file'], false, true, false],
    ['unrelated', ['backend/README.md'], false, false, false],
    ['empty', [], false, false, false],
    ['common CI with tests', ['infra/jenkins/Jenkinsfile.ci', 'frontend/__tests__/course.test.tsx'], true, true, false],
    ['common CI with source', ['infra/jenkins/Jenkinsfile.ci', 'frontend/src/geo.ts'], true, true, false],
    ['common CI only', ['infra/jenkins/Jenkinsfile.ci'], true, true, false],
    ['manual', [], true, true, false],
    ['spaces in test name', ['frontend/__tests__/course flow.test.tsx'], false, false, false],
    ['newline in source name', ['frontend/src/new\nfile.ts'], false, true, false],
]
cases.each { name, files, forceBuild, apk, bundle ->
    assert pipeline.mobileNeedsApk(files, forceBuild) == apk: name
    assert pipeline.mobileNeedsBundle(files, forceBuild) == bundle: name
}
println "APK/JS bundle selection: ${cases.size()} cases passed"

// Execute the actual stage closures with recorded Jenkins steps. Shell commands are not run.
def executePipeline(List files, boolean manual = false, int staleAfter = -1) {
    def mrChecks = 0
    def result = [stages: [], commands: [], credentials: 0, nodes: [], timeouts: []]
    def environment = [
        gitlabMergeRequestIid: manual ? null : '189',
        gitlabTargetBranch: 'dev', gitlabMergeRequestLastCommit: 'source',
        gitlabMergeRequestTitle: 'CI test', BUILD_NUMBER: '1', BUILD_TAG: 'test-build',
    ]
    def context = new Binding([
        env: environment, currentBuild: [currentResult: 'SUCCESS'], none: 'none',
        agent: { ignored -> }, options: { Closure ignored -> },
        pipeline: { Closure body -> body() }, stages: { Closure body -> body() },
        steps: { Closure body -> body() }, script: { Closure body -> body() },
        stage: { String name, Closure body -> result.stages << name; body() },
        node: { String label, Closure body -> result.nodes << label; body() },
        timeout: { Map args, Closure body -> result.timeouts << args.time; body() },
        dir: { String path, Closure body -> body() },
        gitlabCommitStatus: { Map args, Closure body -> body() },
        updateGitlabCommitStatus: { Map args -> },
        deleteDir: { -> }, checkout: { Map args -> }, echo: { message -> },
        junit: { Map args -> [failCount: 0] }, archiveArtifacts: { Map args -> },
        string: { Map args -> args },
        withCredentials: { List args, Closure body -> result.credentials++; body() },
        withEnv: { List args, Closure body -> body() },
        parallel: { Map branches -> branches.values().each { it() } },
        error: { message -> throw new AssertionError(message.toString()) },
        sh: { args ->
            // staleAfter: 몇 번째 MR ref 확인부터 새 커밋이 올라온 것으로 응답할지 (-1이면 항상 최신).
            if (args instanceof Map && args.returnStatus && args.script.contains('refs/remotes/origin/mr/')) {
                mrChecks++
                return staleAfter >= 0 && mrChecks > staleAfter ? 1 : 0
            }
            if (args instanceof Map && args.returnStdout) {
                if (args.script.contains('git diff')) return files.join('\u0000')
                return args.script.contains('rev-parse HEAD') ? 'source\n' : 'target\n'
            }
            result.commands << args.toString()
            return 0
        },
    ])
    try {
        new GroovyShell(jenkinsLoader, context).parse(new File('infra/jenkins/Jenkinsfile.ci')).run()
    } catch (AssertionError err) {
        result.error = err
    }
    return result
}

// [name, files, manual, APK, JS bundle]
def scenarios = [
    ['tests only', ['frontend/__tests__/community.test.tsx'], false, false, false],
    ['source changed', ['frontend/App.tsx'], false, false, true],
    ['mixed source and test', ['frontend/App.tsx', 'frontend/__tests__/community.test.tsx'], false, false, true],
    ['dependency changed', ['frontend/src/geo.ts', 'frontend/pnpm-lock.yaml'], false, true, false],
    ['native changed', ['frontend/android/app/build.gradle'], false, true, false],
    ['common CI', ['infra/jenkins/Jenkinsfile.ci'], false, true, false],
    ['manual', [], true, true, false],
]
scenarios.each { name, files, manual, apk, bundle ->
    def result = executePipeline(files, manual)
    assert result.stages.contains('Mobile Typecheck and Lint'): name
    assert result.commands.contains('sh ../infra/jenkins/check-mobile-static.sh'): name
    assert result.stages.contains('Mobile Tests'): name
    assert result.commands.contains('pnpm exec jest --ci --maxWorkers=2 --cacheDirectory=/home/jenkins/agent/.cache/jest'): name
    assert result.stages.contains('Mobile APK Build') == apk: name
    assert result.commands.contains('sh infra/jenkins/build-mobile-apk.sh') == apk: name
    assert (result.credentials > 0) == apk: name
    assert result.stages.contains('Mobile JS Bundle') == bundle: name
    assert result.commands.any { it.contains('react-native bundle --platform android --dev false') } == bundle: name
}
assert !executePipeline(['docs/development/git-convention.md']).stages.contains('Mobile Tests')
println "Pipeline execution: ${scenarios.size() + 1} scenarios passed"

// 통합 CI는 동시 실행하고, 노드 대기를 뺀 영역 실행 시간만 60분으로 제한한다.
def ciText = new File('infra/jenkins/Jenkinsfile.ci').text
assert !ciText.contains('disableConcurrentBuilds()')
def concurrent = executePipeline(['frontend/App.tsx'])
assert concurrent.error == null: concurrent.error
assert concurrent.nodes == ['backend || mobile || watch || ai', 'mobile']: concurrent.nodes
assert concurrent.timeouts == [60]

// 모바일 노드를 기다리는 동안 같은 MR에 새 커밋이 올라오면 이전 커밋은 검사하지 않고 실패로 끝낸다.
def stale = executePipeline(['frontend/App.tsx'], false, 1)
assert stale.error?.message?.contains('새 커밋'): stale.error
assert stale.stages.contains('Mobile Checkout')
assert !stale.stages.contains('Mobile Dependencies')
// 수동 실행은 MR ref를 확인하지 않는다.
def manualRun = executePipeline([], true, 0)
assert manualRun.error == null: manualRun.error
println "Concurrency and stale MR: 3 scenarios passed"
