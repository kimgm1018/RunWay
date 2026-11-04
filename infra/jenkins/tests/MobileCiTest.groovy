// Run with Groovy 2.4: groovy infra/jenkins/tests/MobileCiTest.groovy
// Parse the actual pipeline and exercise its APK decision without running Jenkins steps.
def binding = new Binding([pipeline: { Closure ignored -> }])
def pipeline = new GroovyShell(binding).parse(new File('infra/jenkins/Jenkinsfile.ci'))
pipeline.run()
['Jenkinsfile.mobile', 'Jenkinsfile.mobile-apk'].each { name ->
    new GroovyShell(binding).parse(new File("infra/jenkins/${name}")).run()
}

def cases = [
    ['root test', ['frontend/__tests__/course.test.tsx'], false, false],
    ['nested test', ['frontend/src/health/__tests__/reader.test.ts'], false, false],
    ['multiple tests', ['frontend/__tests__/course.test.tsx', 'frontend/__tests__/communityApi.test.tsx'], false, false],
    ['test and docs', ['frontend/__tests__/course.test.tsx', 'docs/development/git-convention.md'], false, false],
    ['app source', ['frontend/src/screens/run/RunSession.tsx'], false, true],
    ['mixed app and test', ['frontend/__tests__/course.test.tsx', 'frontend/App.tsx'], false, true],
    ['dependency lock', ['frontend/pnpm-lock.yaml'], false, true],
    ['Jest setup', ['frontend/jest.setup.js'], false, true],
    ['Jest config', ['frontend/jest.config.js'], false, true],
    ['native build', ['frontend/android/app/build.gradle'], false, true],
    ['test fixture', ['frontend/__tests__/fixtures/data.ts'], false, true],
    ['unknown frontend path', ['frontend/new-file'], false, true],
    ['unrelated', ['backend/README.md'], false, false],
    ['empty', [], false, false],
    ['common CI with tests', ['infra/jenkins/Jenkinsfile.ci', 'frontend/__tests__/course.test.tsx'], true, true],
    ['common CI only', ['infra/jenkins/Jenkinsfile.ci'], true, true],
    ['manual', [], true, true],
    ['spaces in test name', ['frontend/__tests__/course flow.test.tsx'], false, false],
    ['newline in source name', ['frontend/src/new\nfile.ts'], false, true],
]
cases.each { name, files, forceBuild, expected ->
    assert pipeline.mobileNeedsApk(files, forceBuild) == expected: name
}
println "APK selection: ${cases.size()} cases passed"

// Execute the actual stage closures with recorded Jenkins steps. Shell commands are not run.
def executePipeline(List files, boolean manual = false) {
    def result = [stages: [], commands: [], credentials: 0]
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
        node: { String label, Closure body -> body() },
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
            if (args instanceof Map && args.returnStdout) {
                if (args.script.contains('git diff')) return files.join('\u0000')
                return args.script.contains('rev-parse HEAD') ? 'source\n' : 'target\n'
            }
            result.commands << args.toString()
            return 0
        },
    ])
    new GroovyShell(context).parse(new File('infra/jenkins/Jenkinsfile.ci')).run()
    return result
}

def scenarios = [
    ['tests only', ['frontend/__tests__/community.test.tsx'], false, false],
    ['source changed', ['frontend/App.tsx'], false, true],
    ['mixed source and test', ['frontend/App.tsx', 'frontend/__tests__/community.test.tsx'], false, true],
    ['common CI', ['infra/jenkins/Jenkinsfile.ci'], false, true],
    ['manual', [], true, true],
]
scenarios.each { name, files, manual, apk ->
    def result = executePipeline(files, manual)
    assert result.stages.contains('Mobile Typecheck and Lint'): name
    assert result.commands.contains('pnpm typecheck'): name
    assert result.commands.contains('pnpm lint'): name
    assert result.stages.contains('Mobile Tests'): name
    assert result.commands.contains('pnpm exec jest --ci --runInBand --cacheDirectory=/home/jenkins/agent/.cache/jest'): name
    assert result.stages.contains('Mobile APK Build') == apk: name
    assert result.commands.contains('sh infra/jenkins/build-mobile-apk.sh') == apk: name
    assert (result.credentials > 0) == apk: name
}
assert !executePipeline(['docs/development/git-convention.md']).stages.contains('Mobile Tests')
println "Pipeline execution: ${scenarios.size() + 1} scenarios passed"
